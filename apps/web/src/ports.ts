export interface TextDocument {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  archived: boolean;
}

// Host ports let the same editor use a different core transport or storage.
export interface TextRepository {
  list(): TextDocument[];
  save(document: TextDocument): void;
  delete(id: string): void;
  duplicate(id: string, newId: string, updatedAt: number): TextDocument;
  setArchived(id: string, archived: boolean): void;
  dispose(): void;
}

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface EditorHost {
  repository: TextRepository;
  clipboard: ClipboardPort;
  createId(): string;
  now(): number;
}
