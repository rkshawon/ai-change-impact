/**
 * AI Provider abstraction for Change Guard.
 *
 * The rest of the extension depends on this interface,
 * never directly on a specific AI vendor.
 */

export type Severity = "low" | "medium" | "high" | "critical";

export interface ChangedFileImpact {
  path: string;
  changes: string[];
}

export interface AffectedFileImpact {
  path: string;
  reason: string;
  severity: Severity;
  evidence?: string;
  line?: number;
}

export interface RiskItem {
  level: Severity;
  description: string;
}

/**
 * A single semantic/behavioral change detected in the diff.
 *
 * Captures old → new substitution with evidence and severity.
 */
export interface SemanticChange {
  file: string;
  description: string;
  oldBehavior: string;
  newBehavior: string;
  severity: Severity;
  evidence: string;
  line?: number;
}

export interface ImpactReport {
  summary: string;
  severity: Severity;
  changedFiles: ChangedFileImpact[];
  affectedFiles: AffectedFileImpact[];
  semanticChanges: SemanticChange[];
  risks: RiskItem[];
  recommendations: string[];
  rawText?: string;
}

/**
 * The data Change Guard sends to the AI provider.
 */
export interface AnalysisContext {
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
 * Implemented by GeminiProvider, OpenAIProvider, or future self-hosted models.
 */
export interface AIProvider {
  /**
   * Run an AI-powered impact analysis on the given changes using project investigation tools.
   *
   * Returns a structured ImpactReport.
   */
  analyzeChanges(context: AnalysisContext): Promise<ImpactReport>;
}

/**
 * Helper to normalize string severity values into valid Severity types.
 */
export function normalizeSeverity(val: unknown, defaultVal: Severity = "low"): Severity {
  if (typeof val !== "string") {
    return defaultVal;
  }
  const lower = val.toLowerCase().trim();
  if (lower === "critical") {
    return "critical";
  }
  if (lower === "high") {
    return "high";
  }
  if (lower === "medium") {
    return "medium";
  }
  return "low";
}

/**
 * Safely parse and normalize raw AI text output into a valid ImpactReport.
 * Handles markdown code fences, malformed fields, and fallback generation.
 */
export function parseImpactReport(rawText: string, changedFilesFallback: string[] = []): ImpactReport {
  let cleaned = rawText.trim();

  // Strip markdown ```json ... ``` code fence if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  // Attempt to locate JSON object substring if surrounded by extra commentary
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);

    const summary = typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "No summary provided by AI.";

    const severity = normalizeSeverity(parsed.severity || parsed.overallSeverity, "low");

    const changedFiles: ChangedFileImpact[] = Array.isArray(parsed.changedFiles)
      ? parsed.changedFiles
          .map((item: unknown) => {
            if (typeof item === "string") {
              return { path: item, changes: [] };
            }
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              const itemPath = typeof obj.path === "string" ? obj.path : "";
              const changes = Array.isArray(obj.changes)
                ? obj.changes.filter((c): c is string => typeof c === "string")
                : [];
              return itemPath ? { path: itemPath, changes } : null;
            }
            return null;
          })
          .filter((item: ChangedFileImpact | null): item is ChangedFileImpact => item !== null)
      : changedFilesFallback.map((p) => ({ path: p, changes: [] }));

    const affectedFiles: AffectedFileImpact[] = Array.isArray(parsed.affectedFiles)
      ? parsed.affectedFiles
          .map((item: unknown) => {
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              const itemPath = typeof obj.path === "string" ? obj.path : "";
              const reason = typeof obj.reason === "string" ? obj.reason : "Affected by changes";
              const itemSev = normalizeSeverity(obj.severity, severity);
              const evidence = typeof obj.evidence === "string" ? obj.evidence : undefined;
              const line = typeof obj.line === "number" && obj.line > 0 ? obj.line : undefined;
              return itemPath ? { path: itemPath, reason, severity: itemSev, evidence, line } : null;
            }
            return null;
          })
          .filter((item: AffectedFileImpact | null): item is AffectedFileImpact => item !== null)
      : [];

    const semanticChanges: SemanticChange[] = Array.isArray(parsed.semanticChanges)
      ? parsed.semanticChanges
          .map((item: unknown) => {
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              const file = typeof obj.file === "string" ? obj.file : "";
              const description = typeof obj.description === "string" ? obj.description : "";
              const oldBehavior = typeof obj.oldBehavior === "string" ? obj.oldBehavior : "";
              const newBehavior = typeof obj.newBehavior === "string" ? obj.newBehavior : "";
              const itemSev = normalizeSeverity(obj.severity, severity);
              const evidence = typeof obj.evidence === "string" ? obj.evidence : "";
              const line = typeof obj.line === "number" && obj.line > 0 ? obj.line : undefined;
              return (file && description)
                ? { file, description, oldBehavior, newBehavior, severity: itemSev, evidence, line }
                : null;
            }
            return null;
          })
          .filter((item: SemanticChange | null): item is SemanticChange => item !== null)
      : [];

    const risks: RiskItem[] = Array.isArray(parsed.risks)
      ? parsed.risks
          .map((item: unknown) => {
            if (typeof item === "string") {
              return { level: severity, description: item };
            }
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              const desc = typeof obj.description === "string" ? obj.description : "";
              const level = normalizeSeverity(obj.level, severity);
              return desc ? { level, description: desc } : null;
            }
            return null;
          })
          .filter((item: RiskItem | null): item is RiskItem => item !== null)
      : [];

    const recommendations: string[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r: unknown): r is string => typeof r === "string" && Boolean(r.trim()))
      : [];

    return {
      summary,
      severity,
      changedFiles,
      affectedFiles,
      semanticChanges,
      risks,
      recommendations,
      rawText,
    };
  } catch {
    // Graceful fallback for non-JSON or malformed outputs
    return {
      summary: rawText.length > 300 ? rawText.slice(0, 300) + "..." : rawText || "AI analysis completed.",
      severity: "low",
      changedFiles: changedFilesFallback.map((p) => ({ path: p, changes: [] })),
      affectedFiles: [],
      semanticChanges: [],
      risks: [],
      recommendations: ["Review the raw analysis below."],
      rawText,
    };
  }
}
