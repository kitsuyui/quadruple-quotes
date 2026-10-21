# Quadruple Quotes for VS Code

The extension runs `quadruple-quotes-lsp` over stdio for plaintext and Markdown in a trusted workspace. Install the binary with `cargo install --path crates/lsp`, or configure an explicit executable path. Restricted Mode does not activate the extension or start any process; trust the workspace before using the language server.

Only core text-health and typos diagnostics and explicit typo quick fixes are available; hover is unavailable. JavaScript rules, markdownlint, textlint, GiNZA, arbitrary plugins, and cloud services are unsupported. Settings go through LSP only; the server never writes files.

Run `bun install`, `bun run build`, and `bun run package` in this directory. The server uses the [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) and the client uses [vscode-languageclient](https://github.com/microsoft/vscode-languageserver-node/tree/main/client).
