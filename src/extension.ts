import * as vscode from "vscode";
import { execFile } from "child_process";
import * as dotenv from "dotenv";
import * as path from "path";
import type { AIProvider, ImpactReport, Severity } from "./ai/AIProvider";
import { GeminiProvider } from "./ai/GeminiProvider";

export function activate(context: vscode.ExtensionContext) {
  /*
   * Load .env from the extension's root directory.
   * This picks up GEMINI_API_KEY / OPENAI_API_KEY without requiring a system env var.
   */
  dotenv.config({ path: path.join(context.extensionPath, ".env") });

  console.log("Change Guard is active!");

  /*
   * ---------------------------------------------------------
   * Command Palette
   * ---------------------------------------------------------
   */

  const previewCommand = vscode.commands.registerCommand(
    "change-guard.previewChanges",
    async () => {
      await previewChanges();
    },
  );

  context.subscriptions.push(previewCommand);

  /*
   * ---------------------------------------------------------
   * Status Bar
   * ---------------------------------------------------------
   */

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  statusBarItem.text = "$(shield) Change Guard";
  statusBarItem.tooltip = "Change Guard: Preview current changes";
  statusBarItem.command = "change-guard.previewChanges";

  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  /*
   * ---------------------------------------------------------
   * Source Control
   * ---------------------------------------------------------
   *
   * This creates a button in the Source Control view.
   */

  const sourceControl = vscode.scm.createSourceControl(
    "change-guard",
    "Change Guard",
  );

  sourceControl.createResourceGroup(
    "changeGuard",
    "Change Guard",
  );

  context.subscriptions.push(sourceControl);

  console.log("Change Guard UI initialized.");
}

/**
 * Main Change Guard action.
 *
 * Triggered from Command Palette, Status bar, or Source Control.
 */
async function previewChanges(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Change Guard: No workspace is open.");
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  try {
    /*
     * -------------------------------------------------------
     * Make sure this is a Git repository
     * -------------------------------------------------------
     */
    await runGit(["rev-parse", "--is-inside-work-tree"], workspacePath);

    /*
     * -------------------------------------------------------
     * Get current changes
     * -------------------------------------------------------
     */
    const diff = await runGit(["diff", "HEAD", "--unified=3"], workspacePath);

    if (!diff.trim()) {
      vscode.window.showInformationMessage(
        "Change Guard: No changes detected.",
      );
      return;
    }

    /*
     * -------------------------------------------------------
     * Get changed files
     * -------------------------------------------------------
     */
    const changedFilesOutput = await runGit(
      ["diff", "HEAD", "--name-only"],
      workspacePath,
    );

    const changedFiles = changedFilesOutput
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);

    console.log("Change Guard - changed files:", changedFiles);

    /*
     * -------------------------------------------------------
     * Run AI investigation and analysis with progress indicator
     * -------------------------------------------------------
     */
    const report = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Change Guard: Investigating project impact with AI...",
        cancellable: false,
      },
      async () => {
        const provider: AIProvider = new GeminiProvider();

        return provider.analyzeChanges({
          workspacePath,
          changedFiles,
          diff,
        });
      },
    );

    /*
     * -------------------------------------------------------
     * Open analysis panel
     * -------------------------------------------------------
     */
    showAnalysisPanel(workspacePath, changedFiles, diff, report);

    vscode.window.showInformationMessage(
      `Change Guard: Impact analysis complete for ${changedFiles.length} file${
        changedFiles.length === 1 ? "" : "s"
      } (${report.severity.toUpperCase()} severity).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /*
     * Mask potential API keys in error dialogs.
     */
    const safeMessage = message
      .replace(/AIza[0-9A-Za-z-_]{35}/g, "AIza***")
      .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");

    vscode.window.showErrorMessage(`Change Guard: ${safeMessage}`);
    console.error("Change Guard error:", error);
  }
}

/**
 * Get visual badge HTML for severity level.
 */
function getSeverityBadge(severity: Severity): string {
  switch (severity) {
    case "critical":
      return '<span class="sev-badge sev-critical">🔴 CRITICAL</span>';
    case "high":
      return '<span class="sev-badge sev-high">🟠 HIGH</span>';
    case "medium":
      return '<span class="sev-badge sev-medium">🟡 MEDIUM</span>';
    case "low":
    default:
      return '<span class="sev-badge sev-low">🟢 LOW</span>';
  }
}

/**
 * Show the current changes & structured impact report in a Webview.
 */
function showAnalysisPanel(
  workspacePath: string,
  changedFiles: string[],
  diff: string,
  report: ImpactReport,
): void {
  const panel = vscode.window.createWebviewPanel(
    "changeGuardPreview",
    "Change Guard Analysis",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  // Handle messages from the webview (e.g. clicking on affected files)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === "openFile" && typeof message.file === "string") {
      try {
        const fileUri = vscode.Uri.file(path.join(workspacePath, message.file));
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        vscode.window.showWarningMessage(
          `Change Guard: Could not open file "${message.file}"`,
        );
      }
    }
  });

  const escapedWorkspace = escapeHtml(workspacePath);
  const escapedDiff = escapeHtml(diff);
  const overallSeverityBadge = getSeverityBadge(report.severity);

  // Render changed files list with items
  const changedFilesHtml = report.changedFiles.length > 0
    ? report.changedFiles
        .map((cf) => {
          const changesHtml = cf.changes && cf.changes.length > 0
            ? `<ul class="sub-changes">${cf.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
            : "";
          return `<div class="file-item">
            <div class="file-path">📄 <strong>${escapeHtml(cf.path)}</strong></div>
            ${changesHtml}
          </div>`;
        })
        .join("")
    : changedFiles
        .map((f) => `<div class="file-item"><div class="file-path">📄 ${escapeHtml(f)}</div></div>`)
        .join("");

  // Render affected files list
  const affectedFilesHtml = report.affectedFiles.length > 0
    ? report.affectedFiles
        .map((af) => {
          const badge = getSeverityBadge(af.severity);
          return `<div class="affected-item" onclick="openProjectFile('${escapeAttr(af.path)}')" title="Click to open in editor">
            <div class="affected-header">
              <span class="file-link">🔗 <strong>${escapeHtml(af.path)}</strong></span>
              ${badge}
            </div>
            <div class="affected-reason">${escapeHtml(af.reason)}</div>
          </div>`;
        })
        .join("")
    : '<div class="empty-state">No downstream affected files detected during investigation.</div>';

  // Render risks
  const risksHtml = report.risks.length > 0
    ? report.risks
        .map((r) => {
          const badge = getSeverityBadge(r.level);
          return `<div class="risk-item">
            <div class="risk-header">${badge}</div>
            <div class="risk-desc">${escapeHtml(r.description)}</div>
          </div>`;
        })
        .join("")
    : '<div class="empty-state">No critical risks identified.</div>';

  // Render recommendations
  const recommendationsHtml = report.recommendations.length > 0
    ? `<ul class="recommendation-list">${report.recommendations
        .map((rec) => `<li>${escapeHtml(rec)}</li>`)
        .join("")}</ul>`
    : '<div class="empty-state">No specific recommendations provided.</div>';

  panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Change Guard</title>
<style>
  :root {
    --border-color: var(--vscode-panel-border, #333333);
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.04));
    --item-hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08));
  }

  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 24px;
    line-height: 1.5;
    margin: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .logo {
    font-size: 32px;
  }

  h1 {
    font-size: 22px;
    margin: 0;
    font-weight: 600;
  }

  .subtitle {
    color: var(--vscode-descriptionForeground, #888888);
    font-size: 13px;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }

  .card-title {
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground, #999999);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-item {
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.05));
  }
  .file-item:last-child {
    border-bottom: none;
  }

  .file-path {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
  }

  .sub-changes {
    margin: 6px 0 0 20px;
    padding: 0;
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #aaaaaa);
  }

  pre.diff-view {
    white-space: pre-wrap;
    overflow-x: auto;
    padding: 14px;
    border-radius: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.25));
    border: 1px solid var(--border-color);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    max-height: 280px;
    overflow-y: auto;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ffffff);
    font-size: 12px;
    font-weight: 500;
  }

  /* Severity badges */
  .sev-badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .sev-low {
    background: rgba(46, 160, 67, 0.2);
    color: #4cd964;
    border: 1px solid rgba(46, 160, 67, 0.4);
  }
  .sev-medium {
    background: rgba(227, 179, 65, 0.2);
    color: #ffd60a;
    border: 1px solid rgba(227, 179, 65, 0.4);
  }
  .sev-high {
    background: rgba(219, 109, 40, 0.2);
    color: #ff9f0a;
    border: 1px solid rgba(219, 109, 40, 0.4);
  }
  .sev-critical {
    background: rgba(248, 81, 73, 0.2);
    color: #ff453a;
    border: 1px solid rgba(248, 81, 73, 0.4);
  }

  /* AI Analysis Box */
  .ai-box {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 20px;
    margin-top: 24px;
    background: var(--card-bg);
  }

  .ai-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
    margin-bottom: 16px;
  }

  .ai-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    margin: 18px 0 8px 0;
    color: var(--vscode-foreground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .summary-text {
    font-size: 14px;
    line-height: 1.6;
    margin: 0 0 16px 0;
  }

  .affected-item {
    background: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.2));
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .affected-item:hover {
    background: var(--item-hover-bg);
  }

  .affected-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .file-link {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    color: var(--vscode-textLink-foreground, #4daafc);
  }

  .affected-reason {
    font-size: 13px;
    color: var(--vscode-foreground);
  }

  .risk-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.05));
  }
  .risk-item:last-child {
    border-bottom: none;
  }

  .risk-desc {
    font-size: 13px;
    flex: 1;
  }

  .recommendation-list {
    margin: 8px 0 0 20px;
    padding: 0;
    font-size: 13px;
  }
  .recommendation-list li {
    margin-bottom: 6px;
  }

  .empty-state {
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #888888);
    font-style: italic;
    padding: 6px 0;
  }
</style>
</head>
<body>

<div class="header">
  <div class="logo">🛡️</div>
  <div>
    <h1>Change Guard</h1>
    <div class="subtitle">Preview and analyze your current project changes with AI investigation.</div>
  </div>
</div>

<div class="card">
  <div class="card-title">Project</div>
  <div>${escapedWorkspace}</div>
</div>

<div class="card">
  <div class="card-title">
    Changed Files
    <span class="badge">${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}</span>
  </div>
  ${changedFilesHtml}
</div>

<div class="card">
  <div class="card-title">Current Git Changes</div>
  <pre class="diff-view">${escapedDiff}</pre>
</div>

<div class="ai-box">
  <div class="ai-header">
    <h2 class="ai-title">🤖 AI Impact Analysis</h2>
    <div>Overall Severity: ${overallSeverityBadge}</div>
  </div>

  <div class="section-title">Summary</div>
  <p class="summary-text">${escapeHtml(report.summary)}</p>

  <div class="section-title">Downstream Affected Files</div>
  <div>${affectedFilesHtml}</div>

  <div class="section-title">Potential Risks</div>
  <div>${risksHtml}</div>

  <div class="section-title">Recommendations</div>
  <div>${recommendationsHtml}</div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function openProjectFile(filePath) {
    vscode.postMessage({
      command: 'openFile',
      file: filePath
    });
  }
</script>

</body>
</html>
`;
}

/**
 * Execute a Git command.
 */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout);
      },
    );
  });
}

/**
 * Escape text before putting it inside HTML content.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escape text for HTML attributes.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

export function deactivate() {}
