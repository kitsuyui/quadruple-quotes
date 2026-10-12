import { validAllowedWord } from "../../../packages/analysis/src/settings";
import type { Diagnostic } from "../../../packages/analysis/src/types";

export type ExceptionAction = "allow-word" | "ignore-rule";
export function DiagnosticExceptionButtons({
  diagnostic,
  text,
  disabled,
  onException,
}: {
  diagnostic: Diagnostic;
  text: string;
  disabled: boolean;
  onException(diagnostic: Diagnostic, action: ExceptionAction): void;
}) {
  const word = text.slice(diagnostic.range.start, diagnostic.range.end);
  return (
    <div className="diagnostic-exceptions">
      {diagnostic.ruleId === "typos.spelling" && validAllowedWord(word) && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onException(diagnostic, "allow-word")}
        >
          Allow “{word}” everywhere
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onException(diagnostic, "ignore-rule")}
      >
        Ignore rule in this document
      </button>
    </div>
  );
}
