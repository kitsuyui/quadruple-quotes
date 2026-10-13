/** Platform-neutral protocol shared by browser, native, and future editor hosts. */
export type Severity = "info" | "warning" | "error";

export interface Range {
  /** UTF-16 offsets: start inclusive, end exclusive. */
  start: number;
  end: number;
}

/** An explicit replacement, checked against the analyzed text before applying. */
export interface TextEdit {
  range: Range;
  expectedText: string;
  newText: string;
}

export interface DiagnosticFix {
  label: string;
  edits: TextEdit[];
}

export interface Diagnostic {
  pluginId: string;
  ruleId: string;
  message: string;
  severity: Severity;
  range: Range;
  /** Context that must stay unchanged to retain this diagnostic during editing.
   * Missing metadata conservatively invalidates on any document edit. */
  invalidationScope?: "range" | "word" | "sentence" | "paragraph" | "document";
  suggestions?: string[];
  fixes?: DiagnosticFix[];
}

export interface DependencyNode {
  id: number;
  text: string;
  range: Range;
  head: number | null;
  relation: string;
  sentence: number;
}

export interface PluginStatus {
  pluginId: string;
  status: "ok" | "disabled" | "skipped" | "error";
  message?: string;
}

export interface RuleDescriptor {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
}

export interface PluginDescriptor {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  runPolicy: "realtime" | "manual";
  rules: RuleDescriptor[];
}

export interface RuleSettings {
  plugins: Record<string, boolean>;
  rules: Record<string, boolean>;
  characterLimit?: number;
  severities?: Record<string, Severity>;
}

export interface DocumentRuleException {
  documentId: string;
  ruleId: string;
}

export interface AnalysisSettings extends RuleSettings {
  /** Case-insensitive ASCII spelling allowlist; unrelated rules remain active. */
  allowedWords?: string[];
  ignoredRules?: DocumentRuleException[];
}

export interface SavedAnalysisPreset {
  name: string;
  settings: RuleSettings;
}

export interface AnalysisRequest {
  documentId: string;
  revision: number;
  text: string;
  format: "text" | "markdown";
  settings: AnalysisSettings;
  manual?: boolean;
}

export interface Metrics {
  characters: number;
  charactersWithoutWhitespace: number;
  unicodeScalars: number;
  utf16Units: number;
  bytes: number;
  lines: number;
  words: number;
}

export interface AnalysisResult {
  documentId: string;
  revision: number;
  metrics: Metrics;
  diagnostics: Diagnostic[];
  dependencies: DependencyNode[];
  statuses: PluginStatus[];
  truncated: boolean;
  elapsedMs?: number;
}

export interface AnalysisPort {
  catalog(): Promise<PluginDescriptor[]>;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
  dispose(): void;
}
