/**
 * OpenAI Provider for Change Guard.
 *
 * Uses OpenAI Chat Completions API with function/tool calling to
 * investigate the project and return a structured ImpactReport.
 */

import type {
  AIProvider,
  AnalysisContext,
  ImpactReport,
  HistoryAnalysisContext,
  HistoryAuditReport,
} from "./AIProvider";
import { parseImpactReport, parseHistoryAuditReport } from "./AIProvider";
import { SYSTEM_PROMPT, HISTORY_AUDIT_SYSTEM_PROMPT } from "./systemPrompt";
import * as projectTools from "../analysis/projectTools";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ITERATIONS = 20;

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
      description: "Get the current Git diff for the workspace (including untracked new files).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project_diagnostics",
      description: "Get active compiler, syntax, and type errors reported by Language Servers for the project (supports Java, C#, C++, Go, Rust, Python, TypeScript, etc.). Optionally filter by file path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional file path substring to filter diagnostics for." },
        },
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

    let userContent =
      `## Workspace Root\n${context.workspacePath}\n\n` +
      `## Changed Files\n${context.changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
      `## Git Diff\n\`\`\`diff\n${context.diff}\n\`\`\`\n\n`;

    if (context.diagnostics && context.diagnostics.length > 0) {
      userContent +=
        `## Active Compiler / Language Diagnostics\n` +
        `${projectTools.formatDiagnostics(context.diagnostics)}\n\n`;
    }

    userContent +=
      "Please investigate the project using the tools to trace dependencies, consumers, compiler diagnostics, and potential impact. " +
      "Then produce the structured JSON impact report.";

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: userContent,
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
        return parseImpactReport(text, context.changedFiles, context.diagnostics);
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
          context.diagnostics || [],
        );

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    const lastMsg = messages[messages.length - 1];
    return parseImpactReport(lastMsg?.content || "", context.changedFiles, context.diagnostics);
  }

  async analyzeHistory(context: HistoryAnalysisContext): Promise<HistoryAuditReport> {
    const key = this.apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key is not set. Add OPENAI_API_KEY to a .env file or set it as an environment variable.",
      );
    }

    let userContent = `## Workspace Root\n${context.workspacePath}\n\n`;

    if (context.userQuery && context.userQuery.trim()) {
      userContent +=
        `## User-Reported Symptom / Issue To Diagnose\n` +
        `"${context.userQuery.trim()}"\n\n` +
        `Please locate the exact commit that introduced this symptom, explain the root cause, and provide a code solution.\n\n`;
    } else {
      userContent +=
        `## Proactive Blind Audit Mode\n` +
        `The developer has not specified a symptom. Please perform a thorough audit across the following sequence of commits to discover ANY bugs, regressions, or broken logic, attribute the culprit commit for each issue, and provide solutions.\n\n`;
    }

    userContent += `## Sequence of Commits to Audit (${context.commits.length} commits total):\n\n`;

    for (let i = 0; i < context.commits.length; i++) {
      const c = context.commits[i];
      userContent += `### Commit #${i + 1}: [${c.shortHash}] ${c.message}\n`;
      userContent += `**Author**: ${c.author} | **Date**: ${c.date} | **Hash**: ${c.hash}\n`;
      if (c.diff) {
        userContent += `\`\`\`diff\n${c.diff}\n\`\`\`\n\n`;
      } else {
        userContent += `*(Diff not loaded)*\n\n`;
      }
    }

    if (context.diagnostics && context.diagnostics.length > 0) {
      userContent +=
        `## Active Workspace Compiler / Language Diagnostics\n` +
        `${projectTools.formatDiagnostics(context.diagnostics)}\n\n`;
    }

    userContent +=
      "Please investigate the project files using the tools to confirm traces and root causes, then output the structured JSON history audit report.";

    const messages: ChatMessage[] = [
      { role: "system", content: HISTORY_AUDIT_SYSTEM_PROMPT },
      {
        role: "user",
        content: userContent,
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
        return parseHistoryAuditReport(text, context.commits);
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
          context.diagnostics || [],
        );

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    const lastMsg = messages[messages.length - 1];
    return parseHistoryAuditReport(lastMsg?.content || "", context.commits);
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
    diagnostics: projectTools.ProjectDiagnostic[] = [],
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

        case "get_project_diagnostics": {
          const filterPath = typeof args.path === "string" ? args.path : undefined;
          return projectTools.formatDiagnostics(diagnostics, filterPath);
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
