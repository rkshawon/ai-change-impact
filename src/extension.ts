import * as vscode from "vscode";
import { execFile } from "child_process";

export function activate(context: vscode.ExtensionContext) {
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

  const sourceControlButton = sourceControl.createResourceGroup(
    "changeGuard",
    "Change Guard",
  );

  /*
   * We don't need to populate this resource group.
   * The button itself will be contributed through package.json.
   */

  context.subscriptions.push(sourceControl);

  console.log("Change Guard UI initialized.");
}

/**
 * Main Change Guard action.
 *
 * This can be triggered from:
 *
 * - Command Palette
 * - Status bar
 * - Source Control
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
     *
     * This includes:
     *
     * - unstaged changes
     * - staged changes
     *
     * Compared against HEAD.
     * -------------------------------------------------------
     */

    const diff = await runGit(["diff", "HEAD", "--unified=3"], workspacePath);

    /*
     * -------------------------------------------------------
     * No changes
     * -------------------------------------------------------
     */

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

    console.log("Change Guard - diff:");

    console.log(diff);

    /*
     * -------------------------------------------------------
     * Show progress while analysis is being prepared
     * -------------------------------------------------------
     */

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,

        title: "Change Guard: Preparing analysis...",

        cancellable: false,
      },

      async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    );

    /*
     * -------------------------------------------------------
     * Open analysis panel
     * -------------------------------------------------------
     */

    showAnalysisPanel(workspacePath, changedFiles, diff);

    /*
     * -------------------------------------------------------
     * Temporary message.
     *
     * This is where AI analysis will be connected.
     * -------------------------------------------------------
     */

    vscode.window.showInformationMessage(
      `Change Guard: ${changedFiles.length} file${
        changedFiles.length === 1 ? "" : "s"
      } ready for AI analysis.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    vscode.window.showErrorMessage(`Change Guard: ${message}`);

    console.error("Change Guard error:", error);
  }
}

/**
 * Show the current changes in a Webview.
 */
function showAnalysisPanel(
  workspacePath: string,
  changedFiles: string[],
  diff: string,
): void {
  const panel = vscode.window.createWebviewPanel(
    "changeGuardPreview",
    "Change Guard",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    },
  );

  const escapedWorkspace = escapeHtml(workspacePath);

  const escapedDiff = escapeHtml(diff);

  panel.webview.html = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline';"
/>

<style>

body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 24px;
  line-height: 1.5;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-size: 28px;
}

h1 {
  font-size: 22px;
  margin: 0;
}

.subtitle {
  color: var(--vscode-descriptionForeground);
  margin-bottom: 24px;
}

.card {
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.file {
  padding: 6px 0;
  font-family: var(--vscode-editor-font-family);
}

pre {
  white-space: pre-wrap;
  overflow-x: auto;
  padding: 16px;
  border-radius: 8px;
  background: var(--vscode-textCodeBlock-background);
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 12px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  font-size: 12px;
}

.ai-box {
  border: 1px dashed var(--vscode-panel-border);
  border-radius: 8px;
  padding: 20px;
  margin-top: 20px;
}

</style>

</head>

<body>

<div class="header">

<div class="logo">🛡️</div>

<div>
<h1>Change Guard</h1>

<div class="subtitle">
Preview and analyze your current project changes.
</div>
</div>

</div>

<div class="card">

<strong>Project</strong>

<p>
${escapedWorkspace}
</p>

</div>

<div class="card">

<strong>Changed files</strong>

<p>
<span class="badge">
${changedFiles.length}
file${changedFiles.length === 1 ? "" : "s"}
</span>
</p>

${changedFiles
  .map((file) => `<div class="file">📄 ${escapeHtml(file)}</div>`)
  .join("")}

</div>

<div class="card">

<strong>Current Git changes</strong>

<pre>${escapedDiff}</pre>

</div>

<div class="ai-box">

<h2>🤖 AI Impact Analysis</h2>

<p>
AI analysis will be connected here.
</p>

<p>
The AI will eventually receive the current
changes and investigate the project to determine
possible effects on:
</p>

<ul>

<li>Other components</li>

<li>Functions and business logic</li>

<li>Data flow</li>

<li>API calls</li>

<li>State management</li>

<li>Types and interfaces</li>

<li>UI behavior</li>

<li>Potential runtime errors</li>

</ul>

</div>

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
 * Escape text before putting it inside HTML.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function deactivate() {}
