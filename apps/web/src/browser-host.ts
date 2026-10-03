import init, { TextWorkspace } from "./generated/quadruple_quotes";
import wasmUrl from "./generated/quadruple_quotes_bg.wasm?url";
import type { EditorHost, TextDocument, TextRepository } from "./ports";

export const STORAGE_KEY = "quadruple-quotes.workspace.v1";

class BrowserTextRepository implements TextRepository {
  private core: TextWorkspace;
  private persisted: string | null;

  constructor(private readonly storage: Storage) {
    this.persisted = storage.getItem(STORAGE_KEY);
    // A malformed snapshot is an error, never a reason to silently clear storage.
    this.core = new TextWorkspace(this.persisted ?? undefined);
  }

  list(): TextDocument[] {
    const snapshot: { documents: TextDocument[] } = JSON.parse(
      this.core.snapshot(),
    );
    return snapshot.documents;
  }

  save(document: TextDocument): void {
    this.commit((next) => next.save(JSON.stringify(document)));
  }

  delete(id: string): void {
    this.commit((next) => next.delete(id));
  }

  duplicate(id: string, newId: string, updatedAt: number): TextDocument {
    return this.commit((next) =>
      JSON.parse(next.duplicate(id, newId, BigInt(updatedAt))),
    );
  }

  setArchived(id: string, archived: boolean): void {
    this.commit((next) => next.set_archived(id, archived));
  }

  dispose(): void {
    this.core.free();
  }

  private commit<T>(mutate: (next: TextWorkspace) => T): T {
    // Reject stale writers, including another tab, rather than losing its edits.
    if (this.storage.getItem(STORAGE_KEY) !== this.persisted) {
      throw new Error(
        "This workspace changed in another tab. Copy your draft, then reload.",
      );
    }
    const next = new TextWorkspace(this.core.snapshot());
    try {
      const result = mutate(next);
      const json = next.snapshot();
      this.storage.setItem(STORAGE_KEY, json);
      this.core.free();
      this.core = next;
      this.persisted = json;
      return result;
    } catch (error) {
      next.free();
      throw error;
    }
  }
}

export async function createBrowserHost(): Promise<EditorHost> {
  await init({ module_or_path: wasmUrl });
  return {
    repository: new BrowserTextRepository(window.localStorage),
    clipboard: {
      readText: () => navigator.clipboard.readText(),
      writeText: (text) => navigator.clipboard.writeText(text),
    },
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}
