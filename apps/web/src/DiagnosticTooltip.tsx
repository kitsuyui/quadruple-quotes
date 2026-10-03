import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Diagnostic } from "../../../packages/analysis/src/types";

export function DiagnosticTooltip({
  id,
  diagnostics,
  pending,
  anchor,
  onEnter,
  onLeave,
}: {
  id: string;
  diagnostics: Diagnostic[];
  pending: boolean;
  anchor: { left: number; top: number; bottom: number };
  onEnter(): void;
  onLeave(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tooltip = element.current;
    if (!tooltip) return;
    const box = tooltip.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(anchor.left, window.innerWidth - box.width - 8),
    );
    const below = anchor.bottom + 6;
    const top =
      below + box.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchor.top - box.height - 6);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.visibility = "visible";
  }, [anchor]);
  return createPortal(
    <div
      id={id}
      ref={element}
      role="tooltip"
      className="diagnostic-tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <ul>
        {diagnostics.map((diagnostic) => (
          <li
            key={`${diagnostic.pluginId}-${diagnostic.ruleId}-${diagnostic.range.start}-${diagnostic.range.end}-${diagnostic.message}`}
          >
            <span
              className={`diagnostic-severity diagnostic-${diagnostic.severity}`}
            >
              {diagnostic.severity === "info"
                ? "Suggestion"
                : diagnostic.severity === "error"
                  ? "Error"
                  : "Warning"}
            </span>
            <p>{diagnostic.message}</p>
            {diagnostic.suggestions?.length ? (
              <p className="diagnostic-suggestions">
                Suggested: {diagnostic.suggestions.join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <small>{pending ? "Rechecking… · " : ""}Esc to dismiss</small>
    </div>,
    document.body,
  );
}
