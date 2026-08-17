/**
 * OpenAI Provider for Change Guard.
 *
 * Uses OpenAI Chat Completions API with function/tool calling to
 * investigate the project and return a structured ImpactReport.
 */

import type { AIProvider, AnalysisContext, ImpactReport } from "./AIProvider";
import { parseImpactReport } from "./AIProvider";
import * as projectTools from "../analysis/projectTools";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ITERATIONS = 20;

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

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a file in the workspace. Path must be workspace-relative.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description: "Search all project files for a text query and return matching relative file paths with line numbers and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for (case-insensitive)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files and directories under a workspace-relative directory path.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Workspace-relative directory path. Use '.' for root." },
        },
        required: ["directory"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_git_diff",
      description: "Get the current Git diff for the workspace.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey?: string, model: string = DEFAULT_MODEL, baseUrl: string = "https://api.openai.com/v1") {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async analyzeChanges(context: AnalysisContext): Promise<ImpactReport> {
    const key = this.apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key is not set. Add OPENAI_API_KEY to a .env file or set it as an environment variable.",
      );
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `## Workspace Root\n${context.workspacePath}\n\n` +
          `## Changed Files\n${context.changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
          `## Git Diff\n\`\`\`diff\n${context.diff}\n\`\`\`\n\n` +
          "Please investigate the project using the tools to trace dependencies, consumers, and potential impact. " +
          "Then produce the structured JSON impact report.",
      },
    ];

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: TOOLS,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message: ChatMessage }>;
      };
      const assistantMessage = data.choices?.[0]?.message;

      if (!assistantMessage) {
        throw new Error("No response message returned from OpenAI.");
      }

      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const text = assistantMessage.content || "";
        return parseImpactReport(text, context.changedFiles);
      }

      // Execute each tool call
      for (const call of assistantMessage.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await this.executeTool(
          call.function.name,
          args,
          context.workspacePath,
        );

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    const lastMsg = messages[messages.length - 1];
    return parseImpactReport(lastMsg?.content || "", context.changedFiles);
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<string> {
    try {
      switch (name) {
        case "read_file": {
          const filePath = typeof args.path === "string" ? args.path.trim() : "";
          if (!filePath) {
            return 'Error: "path" must be a non-empty string.';
          }
          return await projectTools.readFile(workspaceRoot, filePath);
        }

        case "search_files": {
          const query = typeof args.query === "string" ? args.query.trim() : "";
          if (!query) {
            return 'Error: "query" must be a non-empty string.';
          }
          const matches = await projectTools.searchFiles(workspaceRoot, query);
          return matches.length === 0 ? "No files matched." : matches.join("\n");
        }

        case "list_files": {
          const directory = typeof args.directory === "string" ? args.directory : ".";
          const entries = await projectTools.listFiles(workspaceRoot, directory);
          return entries.length === 0 ? "(Empty directory)" : entries.join("\n");
        }

        case "get_git_diff": {
          const diff = await projectTools.getGitDiff(workspaceRoot);
          return diff || "(no changes)";
        }

        default:
          return `Error: Unknown tool "${name}".`;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Error: ${msg}`;
    }
  }
}
