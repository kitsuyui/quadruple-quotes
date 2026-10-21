import { spawn } from "node:child_process";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.ANALYSIS_HOST_PORT ?? 4180);
const allowedOrigins = new Set(
  (
    process.env.ANALYSIS_HOST_ORIGINS ??
    "http://127.0.0.1:5173,http://127.0.0.1:4173,http://localhost:5173,http://localhost:4173"
  ).split(","),
);
const script =
  process.env.ANALYSIS_HOST_SCRIPT ??
  new URL("../../scripts/dependency-parser.py", import.meta.url).pathname;
const python = process.env.ANALYSIS_HOST_PYTHON ?? "python3";
const timeoutMs = Number(process.env.ANALYSIS_HOST_TIMEOUT_MS ?? 30_000);
const japaneseStyleTimeoutMs = Number(
  process.env.ANALYSIS_HOST_JAPANESE_STYLE_TIMEOUT_MS ?? 5_000,
);
const japaneseStyleRunner =
  process.env.ANALYSIS_HOST_JAPANESE_STYLE_RUNNER ??
  new URL("./japanese-style-runner.ts", import.meta.url).pathname;
const bun = process.env.ANALYSIS_HOST_BUN ?? "bun";
const maxOutputFrameBytes = 512 * 1024;
const japaneseRuleIds = new Set([
  "no-doubled-joshi",
  "no-mix-dearu-desumasu",
  "no-redundant-expression",
  "no-abusage",
]);
let child: ReturnType<typeof spawn> | undefined;
type ParserReply = { id: number; ok: true; dependencies: unknown[] };
class ParserError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
  }
}
let pending:
  | {
      id: number;
      text: string;
      resolve: (value: ParserReply) => void;
      reject: (error: Error) => void;
    }
  | undefined;
const tombstones = new Set<number>();
function tombstone(id: number) {
  tombstones.add(id);
  if (tombstones.size > 32) {
    const oldest = tombstones.values().next().value;
    if (oldest !== undefined) tombstones.delete(oldest);
  }
}
let sequence = 0;
let buffered = "";
function startParser() {
  if (child && !child.killed && child.exitCode === null) return child;
  child = undefined;
  child = spawn(python, [script], { stdio: ["pipe", "pipe", "inherit"] });
  buffered = "";
  child.stdout?.on("data", onOutput);
  child.on("error", (error) => failPending(new ParserError(error.message)));
  child.on("exit", () => {
    child = undefined;
    failPending(new ParserError("parser exited"));
  });
  return child;
}
function failPending(error: Error) {
  if (pending) {
    pending.reject(error);
    pending = undefined;
  }
}
function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
function isDependency(value: unknown, textLength: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const dependency = value as Record<string, unknown>;
  const { id, text, relation, sentence, head, range } = dependency;
  if (
    !isNonnegativeInteger(id) ||
    typeof text !== "string" ||
    typeof relation !== "string" ||
    !isNonnegativeInteger(sentence) ||
    (head !== null && !isNonnegativeInteger(head))
  )
    return false;
  if (typeof range !== "object" || range === null) return false;
  const offsets = range as Record<string, unknown>;
  return (
    isNonnegativeInteger(offsets.start) &&
    isNonnegativeInteger(offsets.end) &&
    offsets.start <= offsets.end &&
    offsets.end <= textLength
  );
}
function parserReply(
  value: unknown,
  request: { id: number; text: string },
): ParserReply {
  if (typeof value !== "object" || value === null)
    throw new ParserError("parser emitted an invalid response");
  const reply = value as Record<string, unknown>;
  if (reply.id !== request.id)
    throw new ParserError("parser response id did not match the request");
  if (reply.ok !== true) {
    const message =
      typeof reply.error === "string" && reply.error
        ? reply.error
        : "parser reported a failed analysis";
    throw new ParserError(
      `parser failed: ${message}`,
      message === "GiNZA model missing" ? 503 : 502,
    );
  }
  if (!Array.isArray(reply.dependencies))
    throw new ParserError("parser response dependencies were invalid");
  const textLength = Buffer.byteLength(request.text, "utf16le") / 2;
  if (
    !reply.dependencies.every((dependency) =>
      isDependency(dependency, textLength),
    )
  )
    throw new ParserError("parser response dependency schema was invalid");
  return { id: request.id, ok: true, dependencies: reply.dependencies };
}
function onOutput(chunk: Buffer) {
  buffered += chunk;
  if (Buffer.byteLength(buffered) > maxOutputFrameBytes) {
    buffered = "";
    const overflowing = child;
    child = undefined;
    overflowing?.kill();
    failPending(new ParserError("parser output frame exceeds 512 KiB"));
    return;
  }
  for (;;) {
    const newline = buffered.indexOf("\n");
    if (newline < 0) break;
    let value: unknown;
    try {
      value = JSON.parse(buffered.slice(0, newline));
    } catch {
      buffered = "";
      failPending(new ParserError("parser emitted invalid JSON"));
      continue;
    }
    buffered = buffered.slice(newline + 1);
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { id?: unknown }).id !== "number"
    ) {
      failPending(new ParserError("parser response id was invalid"));
      continue;
    }
    const id = (value as { id: number }).id;
    if (tombstones.delete(id)) continue;
    if (!pending || id < pending.id) continue;
    if (pending.id !== id) {
      failPending(new ParserError("parser response id was unexpected"));
      continue;
    }
    const current = pending;
    pending = undefined;
    try {
      current.resolve(parserReply(value, current));
    } catch (error) {
      current.reject(
        error instanceof Error ? error : new ParserError(String(error)),
      );
    }
  }
}
function dependency(text: string, onAccepted: (id: number) => void) {
  return new Promise<unknown>((resolve, reject) => {
    if (Buffer.byteLength(text, "utf16le") / 2 > 5000 || pending)
      return reject(new Error("request rejected"));
    const id = sequence++;
    pending = { id, text, resolve, reject };
    onAccepted(id);
    const parser = startParser();
    if (!parser.stdin) {
      pending = undefined;
      return reject(new ParserError("parser input unavailable"));
    }
    parser.stdin.write(`${JSON.stringify({ id, text })}\n`);
    setTimeout(() => {
      if (pending?.id === id) {
        pending = undefined;
        tombstone(id);
        reject(new ParserError("parser timeout", 504));
      }
    }, timeoutMs).unref();
  });
}
function japaneseStyle(
  value: unknown,
  onChild: (next: ReturnType<typeof spawn>) => void,
) {
  return new Promise<unknown>((resolve, reject) => {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { text?: unknown }).text !== "string" ||
      Buffer.byteLength((value as { text: string }).text, "utf16le") / 2 >
        5000 ||
      !Array.isArray((value as { rules?: unknown }).rules) ||
      !["text", "markdown"].includes(
        (value as { format?: unknown }).format as string,
      ) ||
      !(value as { rules: unknown[] }).rules.every((rule) =>
        [
          "no-doubled-joshi",
          "no-mix-dearu-desumasu",
          "no-redundant-expression",
          "no-abusage",
        ].includes(rule as string),
      )
    )
      return reject(new ParserError("invalid Japanese style request", 400));
    const runner = spawn(bun, [japaneseStyleRunner], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    onChild(runner);
    let output = "";
    const timer = setTimeout(() => {
      runner.kill();
      reject(new ParserError("Japanese style analysis timed out", 504));
    }, japaneseStyleTimeoutMs).unref();
    runner.stdout?.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxOutputFrameBytes) runner.kill();
    });
    runner.on("error", (error) => reject(new ParserError(error.message)));
    runner.on("exit", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error("Japanese style runner failed");
        const reply = JSON.parse(output) as Record<string, unknown>;
        if (
          reply.ok !== true ||
          !Array.isArray(reply.diagnostics) ||
          reply.diagnostics.length > 200 ||
          !reply.diagnostics.every((diagnostic) =>
            validJapaneseDiagnostic(
              diagnostic,
              (value as { text: string }).text,
            ),
          )
        )
          throw new Error("invalid Japanese style response");
        resolve(reply);
      } catch (error) {
        reject(
          new ParserError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    });
    runner.stdin?.end(JSON.stringify(value));
  });
}
function validJapaneseDiagnostic(value: unknown, text: string) {
  if (typeof value !== "object" || value === null) return false;
  const diagnostic = value as {
    ruleId?: unknown;
    message?: unknown;
    range?: { start?: unknown; end?: unknown };
  };
  const range = diagnostic.range;
  const boundary = (offset: number) =>
    !(
      offset > 0 &&
      offset < text.length &&
      text.charCodeAt(offset - 1) >= 0xd800 &&
      text.charCodeAt(offset - 1) <= 0xdbff &&
      text.charCodeAt(offset) >= 0xdc00 &&
      text.charCodeAt(offset) <= 0xdfff
    );
  return (
    typeof diagnostic.ruleId === "string" &&
    japaneseRuleIds.has(diagnostic.ruleId) &&
    typeof diagnostic.message === "string" &&
    range !== undefined &&
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= text.length &&
    boundary(range.start) &&
    boundary(range.end)
  );
}
createServer(async (request, response) => {
  if (
    request.method !== "POST" ||
    !["/api/dependencies", "/api/japanese-style"].includes(request.url ?? "") ||
    !request.headers["content-type"]?.startsWith("application/json")
  ) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
    response.writeHead(403).end();
    return;
  }
  if (Number(request.headers["content-length"] ?? 0) > 20_000) {
    response.writeHead(413).end();
    return;
  }
  let body = "";
  let bytes = 0;
  let ownedId: number | undefined;
  let ownerCancelled = false;
  let runner: ReturnType<typeof spawn> | undefined;
  const respond = (status: number, value?: unknown) => {
    if (response.destroyed || response.writableEnded) return;
    if (value === undefined) response.writeHead(status).end();
    else
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(value));
  };
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 20_000) {
      respond(413);
      request.destroy();
      return;
    }
    body += chunk;
  });
  const cancelOwned = () => {
    ownerCancelled = true;
    runner?.kill();
    if (ownedId !== undefined && pending?.id === ownedId) {
      const current = pending;
      tombstone(ownedId);
      pending = undefined;
      current.reject(new Error("request cancelled"));
    }
  };
  request.on("aborted", cancelOwned);
  response.on("close", cancelOwned);
  request.on("end", async () => {
    if (response.destroyed || response.writableEnded) return;
    try {
      const value = JSON.parse(body);
      if (request.url === "/api/japanese-style") {
        const result = await japaneseStyle(value, (child) => {
          runner = child;
          if (ownerCancelled) runner?.kill();
        });
        respond(200, result);
        return;
      }
      if (typeof value.text !== "string") throw new Error("text required");
      const result = await dependency(value.text, (id) => {
        ownedId = id;
        if (
          ownerCancelled ||
          request.aborted ||
          request.destroyed ||
          response.destroyed ||
          response.closed ||
          response.writableEnded
        )
          cancelOwned();
      });
      respond(200, result);
    } catch (error) {
      respond(error instanceof ParserError ? error.status : 400, {
        error: String(error),
      });
    }
  });
}).listen(port, host);
process.on("SIGTERM", () => child?.kill());
