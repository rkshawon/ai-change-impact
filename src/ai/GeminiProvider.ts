/**
 * Gemini provider for Change Guard.
 *
 * Uses the Google Gemini API via the @google/genai SDK
 * with function calling to investigate the project and
 * produce an impact analysis.
 */

import type { AIAnalysisRequest, AIProvider } from "./AIProvider";
import * as projectTools from "../analysis/projectTools";

/*
 * -----------------------------------------------------------------
 * Configuration
 * -----------------------------------------------------------------
 */

/**
 * The Gemini model to use.
 *
 * Change this constant to switch models.
 */
const MODEL = "gemini-2.5-flash-lite";

/**
 * Maximum number of tool-call round-trips before we force
 * the model to stop.
 */
const MAX_TOOL_ITERATIONS = 20;

/*
 * -----------------------------------------------------------------
 * System prompt
 * -----------------------------------------------------------------
 */

const SYSTEM_PROMPT = `You are Change Guard, an AI code reviewer embedded in a VS Code extension.

Your job is to analyze the current uncommitted changes in a project and determine
their potential impact across the entire codebase.

## Investigation process

1. Start by reading the Git diff and the list of changed files provided to you.
2. Use \`search_files\` to find where changed symbols (functions, components, types,
   hooks, constants, etc.) are imported or used in other files.
3. Use \`read_file\` to inspect relevant files when you need to understand context.
4. Use \`list_files\` to explore directory structure when needed.
5. Do NOT read the entire project — be targeted in your investigation.

## What to investigate

- Imports and re-exports of changed modules
- Component usage and prop changes
- Function/method callers and argument changes
- Hook dependencies and state management
- API call changes and data flow
- Type/interface changes and downstream consumers
- Business logic and validation changes
- Routing and navigation effects
- Configuration and environment changes
- Test coverage and broken test scenarios
- UI behavior and user-facing changes
- Possible runtime errors introduced by the changes

## Evidence standards

Clearly distinguish between:
- **Confirmed impact**: You found concrete references or usages that will be affected.
- **Likely impact**: Strong evidence suggests an effect, but you could not fully verify.
- **Possible risk**: The change could cause issues under certain conditions.
- **Insufficient evidence**: You found no indication of impact.

Do NOT invent relationships between files.  Only report impacts you found evidence for.

## Output format

Produce your final analysis in this format:

## Summary

What changed — a brief, clear description.

## Impact

What parts of the project may be affected, with file paths and explanations.
Group by confirmed / likely / possible.

## Risks

Concrete potential problems, runtime errors, or breaking changes.

## Recommended checks

Specific tests or manual checks that should be performed before committing.
`;

/*
 * -----------------------------------------------------------------
 * GeminiProvider
 * -----------------------------------------------------------------
 */

export class GeminiProvider implements AIProvider {
  async analyze(request: AIAnalysisRequest): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Gemini API key is not set. " +
          "Add GEMINI_API_KEY to a .env file in the extension root, " +
          "or set it as an environment variable and restart VS Code.",
      );
    }

    /*
     * Dynamic import to handle the ESM-only @google/genai package.
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
          "Search all project files for a text query and return " +
          "matching workspace-relative file paths. " +
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

    /*
     * Create a chat session with tools.
     */
    const chat = ai.chats.create({
      model: MODEL,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

    /*
     * Build the initial user message.
     */
    const userMessage =
      `## Workspace\n\n${request.workspacePath}\n\n` +
      `## Changed files\n\n${request.changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
      `## Git diff\n\n\`\`\`diff\n${request.diff}\n\`\`\``;

    /*
     * Send the initial message.
     */
    let response = await chat.sendMessage({
      message: userMessage,
    });

    /*
     * Tool loop — keep going until we get a final text output
     * or hit the iteration limit.
     */
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      const functionCalls = response.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      iterations++;

      /*
       * Execute each tool call and collect results.
       */
      const functionResponses = [];

      for (const call of functionCalls) {
        const result = await this.executeTool(
          call.name || "",
          (call.args || {}) as Record<string, unknown>,
          request.workspacePath,
        );

        functionResponses.push({
          name: call.name || "",
          response: { result },
        });
      }

      /*
       * Send all function responses back to the model.
       */
      response = await chat.sendMessage({
        message: functionResponses.map((fr) => ({
          functionResponse: fr,
        })),
      });
    }

    /*
     * Extract the final text.
     */
    const text = response.text;

    if (!text && iterations >= MAX_TOOL_ITERATIONS) {
      return (
        "⚠️ The AI reached the maximum number of investigation steps " +
        `(${MAX_TOOL_ITERATIONS}) before producing a final analysis.\n\n` +
        "Try running the analysis again, or reduce the number of changed files."
      );
    }

    return text || "The AI did not produce an analysis.";
  }

  /**
   * Execute a single tool call and return the result as a string.
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

          if (typeof filePath !== "string" || !filePath) {
            return 'Error: "path" must be a non-empty string.';
          }

          return await projectTools.readFile(workspaceRoot, filePath);
        }

        case "search_files": {
          const query = args.query;

          if (typeof query !== "string" || !query) {
            return 'Error: "query" must be a non-empty string.';
          }

          const matches = await projectTools.searchFiles(
            workspaceRoot,
            query,
          );

          if (matches.length === 0) {
            return "No files matched the search query.";
          }

          return matches.join("\n");
        }

        case "list_files": {
          const directory = args.directory;

          if (typeof directory !== "string") {
            return 'Error: "directory" must be a string.';
          }

          const entries = await projectTools.listFiles(
            workspaceRoot,
            directory || ".",
          );

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
      const message =
        error instanceof Error ? error.message : String(error);

      return `Error: ${message}`;
    }
  }
}
