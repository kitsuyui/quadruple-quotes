export type IconName =
  | "plus"
  | "text"
  | "copy"
  | "paste"
  | "save"
  | "trash"
  | "check"
  | "arrow"
  | "menu"
  | "more"
  | "archive"
  | "restore"
  | "close";

const paths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  text: "M8 4h8l4 4v12H4V4h4M14 4v6h6M8 14h8M8 17h5",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  paste: "M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8M8 16h5",
  save: "M5 4h12l3 3v13H4V4h1M8 4v6h8V4M8 20v-6h8v6",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  check: "M5 12l4 4L19 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
  restore: "M4 9h8M4 9V2M4 9a8 8 0 1 1-1 7",
  close: "M6 6l12 12M6 18L18 6",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? "2.8" : "1.6"}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
