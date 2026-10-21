const archive = "quadruple-quotes-vscode-0.1.0.vsix";

function unzip(...args: string[]): string {
  const result = Bun.spawnSync(["unzip", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout);
}

const entries = unzip("-Z1", archive).split("\n").filter(Boolean);
if (!entries.includes("extension/out/extension.js")) {
  throw new Error("VSIX does not contain the bundled extension entry point.");
}

for (const dependency of ["vscode-languageclient", "vscode-jsonrpc"]) {
  const prefix = `extension/node_modules/${dependency}/`;
  if (!entries.some((entry) => entry.startsWith(prefix))) {
    throw new Error(`VSIX omits the ${dependency} runtime dependency.`);
  }
  if (
    !entries.some(
      (entry) =>
        entry.startsWith(prefix) &&
        /(?:^|\/)(?:LICENSE|LICENSE\.txt|license)$/i.test(entry),
    )
  ) {
    throw new Error(`VSIX omits the ${dependency} license notice.`);
  }
}
