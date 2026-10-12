import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  Diagnostic,
  DiagnosticFix,
} from "../../../packages/analysis/src/types";
import {
  DiagnosticExceptionButtons,
  type ExceptionAction,
} from "./DiagnosticExceptionButtons";
import { DiagnosticFixButtons } from "./DiagnosticFixButtons";

export function DiagnosticTooltip({
  id,
  diagnostics,
  pending,
  disabled,
  anchor,
  onEnter,
  onLeave,
  onApply,
  text,
  onException,
}: {
  id: string;
  diagnostics: Diagnostic[];
  pending: boolean;
  disabled: boolean;
  anchor: { left: number; top: number; bottom: number };
  onEnter(): void;
  onLeave(): void;
  onApply(diagnostic: Diagnostic, fix: DiagnosticFix): void;
  text: string;
  onException(diagnostic: Diagnostic, action: ExceptionAction): void;
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
  });
  return createPortal(
    <div
      id={id}
      ref={element}
      role="dialog"
      aria-label="Proofreading details"
      className="diagnostic-tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}
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
            <DiagnosticFixButtons
              fixes={diagnostic.fixes}
              disabled={disabled || pending}
              onApply={(fix) => onApply(diagnostic, fix)}
            />
            <DiagnosticExceptionButtons
              diagnostic={diagnostic}
              text={text}
              disabled={disabled || pending}
              onException={onException}
            />
          </li>
        ))}
      </ul>
      <small>
        {pending ? "Rechecking… · " : ""}Esc to dismiss · Ctrl/Cmd+. for actions
      </small>
    </div>,
    document.body,
  );
}
