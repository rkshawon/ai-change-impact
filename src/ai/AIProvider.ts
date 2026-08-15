/**
 * AI Provider abstraction for Change Guard.
 *
 * The rest of the extension depends on this interface,
 * never directly on a specific AI vendor.
 */

/**
 * The data Change Guard sends to the AI provider.
 */
export interface AIAnalysisRequest {
  /** Absolute path to the workspace root. */
  workspacePath: string;

  /** Workspace-relative paths of changed files. */
  changedFiles: string[];

  /** Full `git diff HEAD --unified=3` output. */
  diff: string;
}

/**
 * Any AI backend must implement this interface.
 *
 * Currently implemented by GeminiProvider.
 * Later this can be replaced with a custom hosted model.
 */
export interface AIProvider {
  /**
   * Run an AI-powered impact analysis on the given changes.
   *
   * Returns the final analysis as a plain-text / Markdown string.
   */
  analyze(request: AIAnalysisRequest): Promise<string>;
}
