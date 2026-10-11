import type { DiagnosticFix } from "../../../packages/analysis/src/types";

export function DiagnosticFixButtons({
  fixes,
  disabled,
  onApply,
}: {
  fixes: DiagnosticFix[] | undefined;
  disabled: boolean;
  onApply(fix: DiagnosticFix): void;
}) {
  if (!fixes?.length) return null;
  return (
    <div className="diagnostic-fixes">
      {fixes.map((fix) => (
        <button
          key={JSON.stringify(fix)}
          className="diagnostic-fix-button"
          type="button"
          disabled={disabled}
          onClick={() => onApply(fix)}
        >
          {fix.label}
        </button>
      ))}
    </div>
  );
}
