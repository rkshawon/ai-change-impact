/**
 * Gemini provider for Change Guard.
 *
 * Uses the Google Gemini API via the @google/genai SDK
 * with function calling to investigate the project and
 * produce a structured impact analysis.
 */

import type { AIProvider, AnalysisContext, ImpactReport } from "./AIProvider";
import { parseImpactReport } from "./AIProvider";
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
 * System prompt
 * -----------------------------------------------------------------
 */

const SYSTEM_PROMPT = `You are Change Guard, an expert AI code investigation agent embedded in a VS Code extension.

Your job is to analyze uncommitted code changes in a project by actively investigating the codebase using tools and producing a structured impact report.

## Investigation Workflow

1. Review the initial list of changed files and Git diff provided in the prompt.
2. Investigate the codebase using the available read-only tools:
   - Use \`search_files\` to discover where modified components, functions, interfaces, constants, hooks, or API endpoints are imported, referenced, or used across the workspace.
   - Use \`read_file\` to inspect relevant consumer files, type definitions, tests, or configuration files.
   - Use \`list_files\` to explore directory hierarchies when appropriate.
   - Use \`get_git_diff\` if you need to re-verify the full diff context.
3. Be targeted: only inspect files that have plausible relationships or dependencies with the changed code.
4. Do NOT make assumptions without evidence — verify actual imports and callers using \`search_files\` and \`read_file\`.

## Severity Assessment Guidelines

Evaluate the overall severity and affected-file severities using these standards:

- "low":
  - Formatting, typo fixes, comments, documentation.
  - Adding or removing debug statements (e.g. console.log).
  - Minor non-functional refactoring.

- "medium":
  - Local logic changes in a single non-shared component/module.
  - Internal bug fixes that do not alter public contracts.
  - UI visual tweaks with localized impact.

- "high":
  - Changes to shared/reusable UI components or utility functions.
  - State management, global store, or data-flow alterations.
  - Authentication, authorization, or routing updates.
  - Database queries, API client modifications, or schema adjustments.

- "critical":
  - Breaking public API contracts or exported library interfaces.
  - Destructive data operations, security vulnerabilities, or permission bypasses.
  - Major application-wide regressions or breaking core business logic.

## Final Output Format

When your investigation is complete, output ONLY a valid JSON object matching this exact schema:

{
  "summary": "Clear, concise summary of the changes and overall impact.",
  "severity": "low" | "medium" | "high" | "critical",
  "changedFiles": [
    {
      "path": "path/to/changed/file.ts",
      "changes": [
        "Description of specific change made in this file"
      ]
    }
  ],
  "affectedFiles": [
    {
      "path": "path/to/downstream/affected_file.ts",
      "reason": "Explanation of how and why this file is affected based on your investigation",
      "severity": "low" | "medium" | "high" | "critical"
    }
  ],
  "risks": [
    {
      "level": "low" | "medium" | "high" | "critical",
      "description": "Concrete risk, edge case, or potential failure point"
    }
  ],
  "recommendations": [
    "Actionable step, test, or review recommendation before merging/committing"
  ]
}
`;

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
  async analyzeChanges(context: AnalysisContext): Promise<ImpactReport> {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Gemini API key is not set. " +
          "Add GEMINI_API_KEY to a .env file in the extension root, " +
          "or set it as an environment variable and restart VS Code.",
      );
    }

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
          "Get the full `git diff HEAD --unified=3` for the workspace.",
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: [] as string[],
        },
      },
    ];

    let lastError: unknown;

    // Iterate through candidate models if high demand/503 is hit
    for (const model of CANDIDATE_MODELS) {
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

    const userMessage =
      `## Workspace Root\n${context.workspacePath}\n\n` +
      `## Changed Files\n${context.changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
      `## Git Diff\n\`\`\`diff\n${context.diff}\n\`\`\`\n\n` +
      "Please investigate the project using the tools to trace dependencies, consumers, and potential impact. " +
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
    return parseImpactReport(text, context.changedFiles);
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

        default:
          return `Error: Unknown tool "${name}".`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }
}
