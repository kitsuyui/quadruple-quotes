import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { Diagnostic } from "../../../packages/analysis/src/types";
import { diagnosticSegments } from "./inline-diagnostics";

/** The native textarea owns editing; its inert mirror only draws diagnostics. */
export function BodyEditor({
  inputRef,
  value,
  diagnostics,
  disabled,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  diagnostics: Diagnostic[];
  disabled: boolean;
  onChange(value: string): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const segments = useMemo(
    () => diagnosticSegments(value, diagnostics),
    [value, diagnostics],
  );

  function syncScroll() {
    const input = inputRef.current;
    if (input && content.current)
      content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !mirror.current) return;
    const sync = () => {
      if (mirror.current) mirror.current.style.width = `${input.clientWidth}px`;
      if (content.current)
        content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    };
    const observer = new ResizeObserver(sync);
    observer.observe(input);
    sync();
    return () => observer.disconnect();
  }, [inputRef]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && content.current)
      content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  });

  return (
    <div className="body-editor">
      <div className="body-mirror" ref={mirror} aria-hidden="true">
        <div className="body-mirror-content body-text" ref={content}>
          {diagnostics.length > 0 &&
            value.length <= 100_000 &&
            segments.map((segment) => (
              <span
                key={segment.start}
                className={
                  segment.severity
                    ? `inline-diagnostic inline-${segment.severity}`
                    : undefined
                }
                data-start={segment.severity ? segment.start : undefined}
                data-end={segment.severity ? segment.end : undefined}
              >
                {value.slice(segment.start, segment.end)}
              </span>
            ))}
          {"\n"}
        </div>
      </div>
      <textarea
        id="text-body"
        ref={inputRef}
        className="body-input body-text"
        aria-describedby="inline-proofreading-summary"
        value={value}
        placeholder="Start writing, or paste something you’d like to keep…"
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        disabled={disabled}
        spellCheck={false}
      />
    </div>
  );
}
