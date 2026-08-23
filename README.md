# Change Guard

**Change Guard** is an AI-powered VS Code extension that analyzes the impact and blast radius of your code changes before you commit. Powered by Gemini, Change Guard inspects your Git diffs, explores codebase dependencies, detects potential language/type errors, and delivers structured, actionable impact reports right inside VS Code.

---

## Features

- **Semantic Change Analysis:** Automatically summarizes modified, added, and deleted files with high-level descriptions of intent.
- **Commit History Audit & Bug Culprit Detection:** Inspect past commits (e.g. last 5, 10, 20 commits or custom range) to discover introduced regressions, attribute the exact culprit commit responsible for each issue, explain root causes, and provide code fixes.
- **Blind Proactive Audits:** Audit past commits without specifying a symptom — Change Guard automatically detects subtle logic breakages, broken handlers, or runtime flaws and tells you which commit caused them.
- **Targeted Symptom Diagnosis:** Describe a specific symptom (e.g. *"button click not working"*), and Change Guard pinpoints the exact commit where it broke and delivers the solution.
- **Blast Radius & Dependency Tracking:** Identifies downstream components, consumers, and APIs that could be affected by your changes.
- **Language & Runtime Error Detection:** Checks for potential breaking type mismatches, missing imports, syntax inconsistencies, and runtime issues.
- **Interactive Webview Panels:** Visualizes impact reports and commit history timeline with copyable code patches and direct file/line jump navigation.
- **Agentic Codebase Inspection:** Leverages project tools and symbol search to verify impact across your repository before generating reports.
- **Seamless Git & IDE Integration:** Trigger analysis with one click from the Status Bar, Source Control (SCM) title bar, or keyboard shortcut.

---

## Getting Started

### Prerequisites
- VS Code `1.125.0` or newer.
- A Git repository with active changes (unstaged or staged).

---

## AI Providers & API Key Configuration

Change Guard works **out-of-the-box** with zero setup required using the built-in Gemini engine. You also have full flexibility to connect your own API keys or switch models anytime.

### Supported AI Providers
- **Google Gemini (Default):** Fast, multimodal codebase analysis (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`).
- **OpenAI:** GPT-4o, GPT-4o-mini, or any custom OpenAI-compatible endpoint.

### How Users Configure API Keys & Providers

1. **Use Out-of-the-Box (Default):**
   - No configuration needed. Just press `Ctrl+Alt+G` to start analyzing changes!
2. **Switch AI Provider:**
   - Press `Ctrl+Shift+P` -> `Change Guard: Select AI Provider` -> Choose **Google Gemini** or **OpenAI**.
3. **Use Your Own Custom API Key:**
   - Press `Ctrl+Shift+P` -> `Change Guard: Set Custom API Key`.
   - Select your provider and paste your key. It will be stored securely in VS Code's encrypted SecretStorage.
4. **Revert to Default Built-in Key:**
   - Press `Ctrl+Shift+P` -> `Change Guard: Clear Custom API Key`.

---

## How to Use
 
### 1. Preview Uncommitted Working Changes
- **Keyboard Shortcut:** `Ctrl+Alt+G` (or `Cmd+Alt+G` on macOS).
- **Status Bar:** Click `$(shield) Change Guard` in the bottom right corner.
- **Source Control View:** Click the Change Guard icon in the SCM title bar.
- **Command Palette:** Run `Ctrl+Shift+P` -> `Change Guard: Preview Changes`.

### 2. Audit Past Commits & Find Bug Culprits (New!)
- **Command Palette:** Run `Ctrl+Shift+P` -> `Change Guard: Audit History` (or type `cg audit`).
- **Choose Depth:** Select `Last 5 Commits`, `Last 10 Commits`, `Last 20 Commits`, or pick a starting commit from your Git log.
- **Proactive Blind Audit vs Targeted Diagnosis:**
  - *Blind Audit (Default):* Press Enter without typing a symptom. Change Guard reviews every commit, detects all regressions or logic bugs, and identifies which commit caused them.
  - *Targeted Diagnosis:* Type what is broken (e.g., *"button click not working"* or *"auth token not refreshing"*). Change Guard traces the bug to the exact culprit commit and provides the code fix.

---

## Extension Settings

Change Guard contributes the following settings (`Ctrl+,` -> search `Change Guard`):

* `changeGuard.provider`: Active AI provider (`"gemini"` or `"openai"`).
* `changeGuard.geminiModel`: Gemini model name (default: `"gemini-3.6-flash"`).
* `changeGuard.openaiModel`: OpenAI model name (default: `"gpt-4o-mini"`).
* `changeGuard.openaiBaseUrl`: Custom API endpoint (default: `"https://api.openai.com/v1"`).

---

## License

This project is licensed under the [MIT License](LICENSE).
