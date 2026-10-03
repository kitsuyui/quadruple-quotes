import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function TextActions({
  title,
  archived,
  saved,
  disabled,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  title: string;
  archived: boolean;
  saved: boolean;
  disabled: boolean;
  onDuplicate(): void;
  onArchive(): void;
  onDelete(): void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target) &&
        ref.current
      ) {
        ref.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function close() {
    if (!ref.current) return;
    ref.current.open = false;
    ref.current.querySelector("summary")?.focus();
  }

  return (
    <details
      ref={ref}
      name="text-actions"
      className="text-actions"
      onToggle={() => {
        if (ref.current?.open)
          ref.current
            .querySelector(".text-action-menu")
            ?.scrollIntoView({ block: "nearest" });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <summary aria-label={`Actions for ${title}`}>
        <Icon name="more" />
      </summary>
      <div className="text-action-menu">
        <button
          type="button"
          disabled={disabled || !saved}
          title={saved ? undefined : "Save this text before duplicating"}
          onClick={() => {
            close();
            onDuplicate();
          }}
        >
          <Icon name="copy" />
          Duplicate text
        </button>
        <button
          type="button"
          disabled={disabled || !saved}
          title={saved ? undefined : "Save this text before archiving"}
          onClick={() => {
            close();
            onArchive();
          }}
        >
          <Icon name={archived ? "restore" : "archive"} />
          {archived ? "Restore text" : "Archive text"}
        </button>
        <button
          type="button"
          className="text-action-delete"
          disabled={disabled}
          onClick={() => {
            close();
            onDelete();
          }}
        >
          <Icon name="trash" />
          Delete text
        </button>
      </div>
    </details>
  );
}
