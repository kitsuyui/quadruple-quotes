# Quadruple Quotes desktop host

The desktop host embeds the existing React editor in a Tauri v2 WebView. It keeps
workspace snapshots, settings, and recovery drafts in the WebView's existing
storage so its browser behavior remains unchanged.

Run `bun run desktop:dev` for local development or `bun run desktop:build` to
produce a native bundle. The host offers only user-mediated open and save dialogs
and clipboard commands. It does not expose arbitrary filesystem access, shell or
process execution, automatic native analyzers, or remote navigation.

Native GiNZA and Japanese morphology analysis are intentionally unavailable in
this first desktop host.
The existing browser/WASM rule analysis remains the shared implementation.
