import { useEffect, useRef } from "react";

export function Confirmation({
  kind,
  title,
  onCancel,
  onDiscard,
  onSave,
}: {
  kind: "leave" | "delete";
  title: string;
  onCancel(): void;
  onDiscard(): void;
  onSave(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirmation"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <span className="eyebrow">
        {kind === "leave" ? "A LITTLE PAUSE" : "REMOVE TEXT"}
      </span>
      <h2>{kind === "leave" ? "Keep your changes?" : "Delete this text?"}</h2>
      <p>
        {kind === "leave"
          ? "You have unsaved changes. Save them before moving on, or discard this draft."
          : `“${title || "Untitled text"}” will be removed from this workspace. This cannot be undone.`}
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={kind === "delete" ? "danger-button" : ""}
          onClick={onDiscard}
        >
          {kind === "leave" ? "Discard" : "Delete text"}
        </button>
        {kind === "leave" && (
          <button type="button" className="primary" onClick={onSave}>
            Save & continue
          </button>
        )}
      </div>
    </dialog>
  );
}
