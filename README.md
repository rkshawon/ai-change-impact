# Change Guard

**Change Guard** is an AI-powered VS Code extension that analyzes the impact and blast radius of your code changes before you commit. Powered by Gemini, Change Guard inspects your Git diffs, explores codebase dependencies, detects potential language/type errors, and delivers structured, actionable impact reports right inside VS Code.

---

## Features

- **Semantic Change Analysis:** Automatically summarizes modified, added, and deleted files with high-level descriptions of intent.
- **Blast Radius & Dependency Tracking:** Identifies downstream components, consumers, and APIs that could be affected by your changes.
- **Language & Runtime Error Detection:** Checks for potential breaking type mismatches, missing imports, syntax inconsistencies, and runtime issues.
- **Interactive Impact Webview:** Visualizes changes by severity (Critical, Warning, Info) with detailed rationales and remediation suggestions.
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

1. **Make code changes** in your Git repository.
2. Trigger **Change Guard**:
   - **Keyboard Shortcut:** `Ctrl+Alt+G` (or `Cmd+Alt+G` on macOS).
   - **Status Bar:** Click `$(shield) Change Guard` in the bottom right corner.
   - **Source Control View:** Click the Change Guard icon in the SCM title bar.
   - **Command Palette:** Run `Ctrl+Shift+P` -> `Change Guard: Preview Changes`.
3. An interactive webview panel opens displaying the blast radius, semantic changes, compiler diagnostics, and recommendations.

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
