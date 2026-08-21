/**
 * Gemini provider for Change Guard.
 *
 * Uses the Google Gemini API via the @google/genai SDK
 * with function calling to investigate the project and
 * produce a structured impact analysis.
 */

import type { AIProvider, AnalysisContext, ImpactReport } from "./AIProvider";
import { parseImpactReport } from "./AIProvider";
import { SYSTEM_PROMPT } from "./systemPrompt";
import * as projectTools from "../analysis/projectTools";

/*
 * -----------------------------------------------------------------
 * Configuration
 * -----------------------------------------------------------------
 */

/**
 * Candidate models to try in order of priority.
 * If a model is temporarily unavailable (503/429), it automatically falls back.
 */
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
];

/**
 * Maximum number of tool-call round-trips before forced termination.
 */
const MAX_TOOL_ITERATIONS = 20;

/*
 * -----------------------------------------------------------------
 * Helper: Sleep
 * -----------------------------------------------------------------
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * -----------------------------------------------------------------
 * GeminiProvider
 * -----------------------------------------------------------------
 */

export class GeminiProvider implements AIProvider {
  private apiKey: string;
  private customModel?: string;

  constructor(apiKey?: string, customModel?: string) {
    this.apiKey =
      apiKey ||
      process.env.GEMINI_API_KEY ||
      (process.env as Record<string, string | undefined>).BUILTIN_DEFAULT_GEMINI_KEY ||
      "";
    this.customModel = customModel;
  }

  async analyzeChanges(context: AnalysisContext): Promise<ImpactReport> {
    const apiKey = this.apiKey;

    if (!apiKey) {
      throw new Error(
        "Gemini API key is not set. Use 'Change Guard: Set Custom API Key' to provide your API key.",
      );
    }

    const candidateModels = [
      this.customModel || process.env.GEMINI_MODEL || "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
    ];

    /*
     * Dynamic import to handle ESM module @google/genai package.
     */
    const { GoogleGenAI, Type } = await import("@google/genai");

    const ai = new GoogleGenAI({ apiKey });

    /*
     * Define tool declarations with explicit types.
     */
    const toolDeclarations: any[] = [
      {
        name: "read_file",
        description:
          "Read the contents of a file in the workspace. " +
          "The path must be workspace-relative (e.g. src/index.ts).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: {
              type: Type.STRING,
              description: "Workspace-relative file path.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "search_files",
        description:
          "Search all project files for a text query and return matching " +
          "workspace-relative file paths with line numbers and snippets. " +
          "Useful for finding imports, usages, and references.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "Text to search for (case-insensitive).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_files",
        description:
          "List files and directories under a workspace-relative directory. " +
          "Directories end with a trailing slash.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            directory: {
              type: Type.STRING,
              description:
                'Workspace-relative directory path. Use "." for the root.',
            },
          },
          required: ["directory"],
        },
      },
      {
        name: "get_git_diff",
        description:
          "Get the full `git diff HEAD --unified=3` for the workspace (including untracked new files).",
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: [] as string[],
        },
      },
      {
        name: "get_project_diagnostics",
        description:
          "Get active compiler, syntax, and type errors reported by Language Servers " +
          "for the project (works for Java, C#, C++, Go, Rust, Python, TypeScript, etc.). " +
          "Optionally filter by workspace-relative file path.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: {
              type: Type.STRING,
              description: "Optional file path substring to filter diagnostics for.",
            },
          },
          required: [] as string[],
        },
      },
    ];

    let lastError: unknown;

    // Iterate through candidate models if high demand/503 is hit
    for (const model of candidateModels) {
      try {
        return await this.runInvestigationWithModel(
          ai,
          model,
          toolDeclarations,
          context,
        );
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || "");
        const isUnavailable =
          err?.status === 503 ||
          msg.includes("503") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          err?.status === 429 ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED");

        if (isUnavailable) {
          console.warn(`Change Guard: Model ${model} is experiencing high demand. Trying fallback...`);
          await sleep(1000);
          continue;
        }

        // If it's another non-availability error, throw immediately
        throw err;
      }
    }

    throw lastError || new Error("All Gemini candidate models are currently unavailable. Please try again later.");
  }

  private async runInvestigationWithModel(
    ai: any,
    modelName: string,
    toolDeclarations: any[],
    context: AnalysisContext,
  ): Promise<ImpactReport> {
    const chat = ai.chats.create({
      model: modelName,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

    let userMessage =
      `## Workspace Root\n${context.workspacePath}\n\n` +
      `## Changed Files\n${context.changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
      `## Git Diff\n\`\`\`diff\n${context.diff}\n\`\`\`\n\n`;

    if (context.diagnostics && context.diagnostics.length > 0) {
      userMessage +=
        `## Active Compiler / Language Diagnostics\n` +
        `${projectTools.formatDiagnostics(context.diagnostics)}\n\n`;
    }

    userMessage +=
      "Please investigate the project using the tools to trace dependencies, consumers, compiler diagnostics, and potential impact. " +
      "Then produce the structured JSON impact report.";

    let response = await this.sendMessageWithRetry(chat, { message: userMessage });

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      const functionCalls = response.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      iterations++;

      const functionResponses = [];

      for (const call of functionCalls) {
        const result = await this.executeTool(
          call.name || "",
          (call.args || {}) as Record<string, unknown>,
          context.workspacePath,
          context.diagnostics || [],
        );

        functionResponses.push({
          name: call.name || "",
          response: { result },
        });
      }

      response = await this.sendMessageWithRetry(chat, {
        message: functionResponses.map((fr) => ({
          functionResponse: fr,
        })),
      });
    }

    const text = response.text || "";
    return parseImpactReport(text, context.changedFiles, context.diagnostics);
  }

  /**
   * Send a chat message with exponential backoff on transient 503/429 errors.
   */
  private async sendMessageWithRetry(chat: any, params: any, maxRetries = 2): Promise<any> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await chat.sendMessage(params);
      } catch (err: any) {
        const msg = String(err?.message || "");
        const isTransient =
          err?.status === 503 ||
          msg.includes("503") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          err?.status === 429;

        if (isTransient && attempt < maxRetries) {
          const delay = (attempt + 1) * 1500;
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Execute a single tool call against projectTools and return the result string.
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
    diagnostics: projectTools.ProjectDiagnostic[] = [],
  ): Promise<string> {
    try {
      switch (name) {
        case "read_file": {
          const filePath = args.path;
          if (typeof filePath !== "string" || !filePath.trim()) {
            return 'Error: "path" must be a non-empty string.';
          }
          return await projectTools.readFile(workspaceRoot, filePath.trim());
        }

        case "search_files": {
          const query = args.query;
          if (typeof query !== "string" || !query.trim()) {
            return 'Error: "query" must be a non-empty string.';
          }
          const matches = await projectTools.searchFiles(workspaceRoot, query.trim());
          if (matches.length === 0) {
            return "No files matched the search query.";
          }
          return matches.join("\n");
        }

        case "list_files": {
          const directory = typeof args.directory === "string" ? args.directory : ".";
          const entries = await projectTools.listFiles(workspaceRoot, directory);
          if (entries.length === 0) {
            return "(Empty directory)";
          }
          return entries.join("\n");
        }

        case "get_git_diff": {
          const diff = await projectTools.getGitDiff(workspaceRoot);
          return diff || "(no changes)";
        }

        case "get_project_diagnostics": {
          const filterPath = typeof args.path === "string" ? args.path : undefined;
          return projectTools.formatDiagnostics(diagnostics, filterPath);
        }

        default:
          return `Error: Unknown tool "${name}".`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }
}
