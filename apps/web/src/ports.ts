export interface TextDocument {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  archived: boolean;
  format?: "text" | "markdown";
}

// Host ports let the same editor use a different core transport or storage.
export interface TextRepository {
  list(): TextDocument[];
  save(document: TextDocument): void;
  delete(id: string): void;
  duplicate(id: string, newId: string, updatedAt: number): TextDocument;
  setArchived(id: string, archived: boolean): void;
  snapshot(): string;
  inspectImport(json: string): TextDocument[];
  importSnapshot(json: string, newIds: string[]): void;
  dispose(): void;
}

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface EditorHost {
  repository: TextRepository;
  clipboard: ClipboardPort;
  analysis: AnalysisPort;
  files: FilePort;
  recovery: RecoveryPort;
  createId(): string;
  now(): number;
}

export interface FileSource {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface FilePort {
  read(file: FileSource, maxBytes: number): Promise<string>;
  download(name: string, text: string, mime: string): void | Promise<void>;
  pick?(): Promise<FileSource | null>;
}
export interface RecoveryRecord {
  schemaVersion: 1;
  document: TextDocument;
  base: TextDocument | null;
  updatedAt: number;
}
export interface RecoveryEntry {
  key: string;
  raw: string;
  record: RecoveryRecord;
}
export interface RecoveryPort {
  list(): { entries: RecoveryEntry[]; errors: string[] };
  write(record: RecoveryRecord, previous: RecoveryEntry | null): RecoveryEntry;
  remove(entry: RecoveryEntry): void;
  rawBackup(): string;
}

import type { AnalysisPort } from "../../../packages/analysis/src/types";
