import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Diagnostic } from "../../../packages/analysis/src/types";
import { DiagnosticTooltip } from "./DiagnosticTooltip";
import {
  type DiagnosticSegment,
  diagnosticSegments,
} from "./inline-diagnostics";

type TooltipTarget = {
  segment: DiagnosticSegment;
  rect: DOMRect;
  source: "pointer" | "caret";
};
type HitMap = {
  viewport: DOMRect;
  segments: DiagnosticSegment[];
  marks: { segment: DiagnosticSegment; rect: DOMRect }[];
};

/** The native textarea owns editing; its inert mirror only draws diagnostics. */
export function BodyEditor({
  inputRef,
  value,
  diagnostics,
  pending,
  composing,
  disabled,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  diagnostics: Diagnostic[];
  pending: boolean;
  composing: boolean;
  disabled: boolean;
  onChange(value: string): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [active, setActive] = useState<TooltipTarget | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const dismissed = useRef<DiagnosticSegment | null>(null);
  const hitMap = useRef<HitMap | null>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const selectionFrame = useRef<number | undefined>(undefined);
  const segments = useMemo(
    () => diagnosticSegments(value, diagnostics),
    [value, diagnostics],
  );

  const cancelLeave = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
  }, []);
  const invalidate = useCallback(() => {
    hitMap.current = null;
    dismissed.current = null;
    cancelLeave();
    window.cancelAnimationFrame(selectionFrame.current ?? 0);
    setActive(null);
  }, [cancelLeave]);
  const leave = useCallback(() => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => setActive(null), 180);
  }, [cancelLeave]);

  function geometry() {
    if (!diagnostics.length) return null;
    if (hitMap.current) return hitMap.current;
    if (!inputRef.current || !content.current) return null;
    const viewport = inputRef.current.getBoundingClientRect();
    const marks: HitMap["marks"] = [];
    for (const element of content.current.querySelectorAll<HTMLElement>(
      ".inline-diagnostic",
    )) {
      const segment = segments[Number(element.dataset.segment)];
      if (!segment?.diagnosticIndices) continue;
      for (const rect of element.getClientRects())
        if (
          rect.bottom >= viewport.top &&
          rect.top <= viewport.bottom &&
          rect.right >= viewport.left &&
          rect.left <= viewport.right
        )
          marks.push({ segment, rect });
    }
    hitMap.current = { viewport, marks, segments };
    return hitMap.current;
  }

  function show(
    segment: DiagnosticSegment,
    rect: DOMRect,
    source: TooltipTarget["source"],
  ) {
    cancelLeave();
    if (dismissed.current === segment) return;
    setActive((current) =>
      current?.segment === segment &&
      current.rect.top === rect.top &&
      current.source === source
        ? current
        : { segment, rect, source },
    );
  }

  function pointAt(x: number, y: number, source: TooltipTarget["source"]) {
    if (composing) return;
    const map = geometry();
    const hit =
      map &&
      x >= map.viewport.left &&
      x <= map.viewport.right &&
      y >= map.viewport.top &&
      y <= map.viewport.bottom
        ? map.marks.find(
            ({ rect }) =>
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom + 4,
          )
        : undefined;
    if (hit) show(hit.segment, hit.rect, source);
    else {
      dismissed.current = null;
      leave();
    }
  }

  function selectIssue() {
    if (composing) return;
    const input = inputRef.current;
    const previous = dismissed.current;
    if (
      input &&
      previous &&
      (input.selectionEnd < previous.start ||
        input.selectionStart > previous.end)
    )
      dismissed.current = null;
    window.cancelAnimationFrame(selectionFrame.current ?? 0);
    selectionFrame.current = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const segment = segments.find(
        (segment) =>
          segment.diagnosticIndices &&
          (start === end
            ? start >= segment.start && start <= segment.end
            : start < segment.end && end > segment.start),
      );
      const mark = segment
        ? geometry()?.marks.find((mark) => mark.segment === segment)
        : undefined;
      if (mark) show(mark.segment, mark.rect, "caret");
      else {
        dismissed.current = null;
        cancelLeave();
        setActive(null);
      }
    });
  }

  function syncScroll() {
    const input = inputRef.current;
    if (input && content.current)
      content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    invalidate();
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !mirror.current) return;
    const sync = () => {
      if (mirror.current) mirror.current.style.width = `${input.clientWidth}px`;
      if (content.current)
        content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
      invalidate();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(input);
    sync();
    return () => observer.disconnect();
  }, [inputRef, invalidate]);

  useLayoutEffect(() => {
    // A new revision must never keep the previous message or hit boxes.
    if (hitMap.current?.segments !== segments) invalidate();
  }, [segments, invalidate]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissed.current = activeRef.current?.segment ?? null;
      cancelLeave();
      setActive(null);
    };
    const onScroll = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".diagnostic-tooltip")
      )
        return;
      invalidate();
    };
    window.addEventListener("keydown", dismiss);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", invalidate);
    document.fonts.addEventListener("loadingdone", invalidate);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", invalidate);
      document.fonts.removeEventListener("loadingdone", invalidate);
      cancelLeave();
      window.cancelAnimationFrame(selectionFrame.current ?? 0);
    };
  }, [cancelLeave, invalidate]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && content.current)
      content.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  });

  const target = active && segments.includes(active.segment) ? active : null;
  const issues =
    target?.segment.diagnosticIndices?.map((index) => diagnostics[index]) ?? [];

  return (
    <div className="body-editor">
      <div className="body-mirror" ref={mirror} aria-hidden="true">
        <div className="body-mirror-content body-text" ref={content}>
          {diagnostics.length > 0 &&
            value.length <= 100_000 &&
            segments.map((segment, index) => (
              <span
                key={segment.start}
                className={
                  segment.severity
                    ? `inline-diagnostic inline-${segment.severity}`
                    : undefined
                }
                data-start={segment.severity ? segment.start : undefined}
                data-end={segment.severity ? segment.end : undefined}
                data-segment={segment.severity ? index : undefined}
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
        aria-describedby={`inline-proofreading-summary${target ? ` ${tooltipId}` : ""}`}
        value={value}
        placeholder="Start writing, or paste something you’d like to keep…"
        onChange={(event) => {
          invalidate();
          onChange(event.target.value);
        }}
        onScroll={syncScroll}
        onPointerMove={(event) => {
          if (event.pointerType === "touch" || event.buttons) return;
          pointAt(event.clientX, event.clientY, "pointer");
        }}
        onPointerDown={invalidate}
        onPointerLeave={() => {
          dismissed.current = null;
          leave();
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") return;
          const { clientX, clientY } = event;
          window.cancelAnimationFrame(selectionFrame.current ?? 0);
          selectionFrame.current = window.requestAnimationFrame(() =>
            pointAt(clientX, clientY, "caret"),
          );
        }}
        onSelect={selectIssue}
        onKeyUp={selectIssue}
        onBlur={leave}
        onCompositionStart={() => {
          invalidate();
          onCompositionStart();
        }}
        onCompositionEnd={onCompositionEnd}
        disabled={disabled}
        spellCheck={false}
      />
      {target && issues.length > 0 && (
        <DiagnosticTooltip
          id={tooltipId}
          diagnostics={issues}
          pending={pending}
          anchor={target.rect}
          onEnter={cancelLeave}
          onLeave={leave}
        />
      )}
    </div>
  );
}
