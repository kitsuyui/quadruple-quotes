import type {
  RecoveryEntry,
  RecoveryPort,
  RecoveryRecord,
  TextDocument,
} from "./ports";

export const RECOVERY_PREFIX = "quadruple-quotes.draft.v1.";
export const MAX_RECOVERY_ENTRIES = 50;
export const MAX_RECOVERY_BYTES = 10 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sameDocument(
  a: TextDocument | null | undefined,
  b: TextDocument | null | undefined,
) {
  if (!a || !b) return !a && !b;
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.body === b.body &&
    a.updatedAt === b.updatedAt &&
    a.archived === b.archived &&
    (a.format ?? "text") === (b.format ?? "text")
  );
}

export function recoveryDocument(
  record: RecoveryRecord,
  saved: TextDocument | undefined,
  newId: string,
): TextDocument {
  // A changed/deleted saved text or a colliding new draft is recovered independently.
  if (sameDocument(record.base, saved)) return { ...record.document };
  return {
    ...record.document,
    id: newId,
    archived: false,
    title: `${record.document.title || "Untitled text"} (recovered copy)`,
  };
}

/** Document parsing is supplied by the same Rust workspace codec as saved texts. */
export class BrowserRecoveryStore implements RecoveryPort {
  constructor(
    private readonly storage: Storage,
    private readonly validateDocument: (value: unknown) => TextDocument,
    private readonly createId: () => string,
  ) {}

  private parse(raw: string): RecoveryRecord {
    if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES)
      throw new Error("Recovery data exceeds 10 MiB.");
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      Object.keys(value).some(
        (key) =>
          !["schemaVersion", "document", "base", "updatedAt"].includes(key),
      ) ||
      value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.updatedAt) ||
      (value.updatedAt as number) < 0 ||
      (value.updatedAt as number) > 8_640_000_000_000_000
    )
      throw new Error("Unsupported or invalid recovery data.");
    const document = this.validateDocument(value.document);
    const base = value.base === null ? null : this.validateDocument(value.base);
    if (base && base.id !== document.id)
      throw new Error(
        "Recovery document identity does not match its saved base.",
      );
    return {
      schemaVersion: 1,
      document,
      base,
      updatedAt: value.updatedAt as number,
    };
  }

  list() {
    const entries: RecoveryEntry[] = [];
    const errors: string[] = [];
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key?.startsWith(RECOVERY_PREFIX)) continue;
        if (entries.length + errors.length >= MAX_RECOVERY_ENTRIES) {
          errors.push(
            "More than 50 recovery records exist. Existing records have been kept.",
          );
          break;
        }
        try {
          const raw = this.storage.getItem(key);
          if (raw !== null) entries.push({ key, raw, record: this.parse(raw) });
        } catch {
          errors.push(
            `Could not read recovery record ${key.slice(RECOVERY_PREFIX.length)}. Its data has been kept.`,
          );
        }
      }
    } catch {
      errors.push("Browser recovery storage is unavailable.");
    }
    return {
      entries: entries.sort((a, b) => b.record.updatedAt - a.record.updatedAt),
      errors,
    };
  }

  write(record: RecoveryRecord, previous: RecoveryEntry | null): RecoveryEntry {
    if (
      previous &&
      (!previous.key.startsWith(RECOVERY_PREFIX) ||
        previous.key.length <= RECOVERY_PREFIX.length)
    )
      throw new Error("Invalid recovery storage key.");
    const raw = JSON.stringify(record);
    const parsed = this.parse(raw);
    const key = previous?.key ?? `${RECOVERY_PREFIX}${this.createId()}`;
    const current = this.storage.getItem(key);
    if (current !== (previous?.raw ?? null))
      throw new Error(
        "Recovery data changed in another tab. Your current draft is still here.",
      );
    if (!previous) {
      let count = 0;
      for (let index = 0; index < this.storage.length; index++) {
        if (this.storage.key(index)?.startsWith(RECOVERY_PREFIX)) count++;
      }
      if (count >= MAX_RECOVERY_ENTRIES)
        throw new Error(
          "Recovery storage contains 50 records. Review them before creating another.",
        );
    }
    this.storage.setItem(key, raw);
    return { key, raw, record: parsed };
  }

  remove(entry: RecoveryEntry) {
    if (
      !entry.key.startsWith(RECOVERY_PREFIX) ||
      entry.key.length <= RECOVERY_PREFIX.length
    )
      throw new Error("Invalid recovery storage key.");
    if (this.storage.getItem(entry.key) !== entry.raw)
      throw new Error(
        "Recovery data changed in another tab. Refresh the recovery list first.",
      );
    this.storage.removeItem(entry.key);
  }

  rawBackup() {
    const records: Record<string, string | null> = {};
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (key?.startsWith(RECOVERY_PREFIX))
        records[key] = this.storage.getItem(key);
    }
    return JSON.stringify({ records }, null, 2);
  }
}
