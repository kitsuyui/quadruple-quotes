# AGENTS.md

## 方針

- この repository は Rust core と React Web UI を持つテキスト管理ツールです。
- 現段階の実装対象はテキスト管理とローカル校正です。校正にはルール切替、インライン指摘、明示的な候補適用、本文の Undo／Redo、指摘間の移動を含みます。
- LSP、VSCode 拡張、Tauri は WIP です。依頼なしに scaffold や依存を追加しません。
- 公開されるコードコメント、README、設計文書、commit message、PR は英語で記述します。
- 他 repository の内部運用、private path、内部 Issue / PR を公開成果物へ含めません。

## 境界

- `crates/core` は UI、clipboard、filesystem、browser、LSP、Tauri を知りません。
- `crates/wasm` は core の transport adapter です。ドメインの処理を二重実装しません。
- `apps/web/src/ports.ts` に UI が必要とする host capability を置き、browser 固有の処理は `browser-host.ts` へ閉じ込めます。
- 保存形式の変更は互換性を確認します。不正・未知バージョンの snapshot を空のデータへ上書きしません。
- 本文の whitespace と Unicode を保持します。ユーザーの明示的な保存操作前に保存済み本文を更新しません。
- 修正候補は解析時の文書 ID・版・元の本文範囲を検証し、下書きにだけ適用します。再チェック待ちの指摘や IME 入力中の候補を適用しません。
- 校正設定とプリセットは本文から分離して保存します。プリセット適用で許可単語や文書別の例外を消さず、重要度と文書除外の判定は Rust core に集約します。設定変更では古い指摘・修正を無効化し、壊れた設定や他タブの更新を上書きしません。

## 検証

- `just check` で Rust format / Clippy / tests、Biome、TypeScript、WASM + Web build、Playwright を実行します。
- 先に `bunx playwright install chromium` を実行してテスト用 browser を用意します。
- UI を変更したら desktop / mobile の表示と keyboard 操作を確認します。
- generated WASM、build output、runtime cache、テスト artifact は commit しません。
