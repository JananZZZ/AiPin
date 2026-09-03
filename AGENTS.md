# AiPin Agent Instructions

## Product invariants

- AiPin is a Windows 10/11 x64, local-first, multi-model comparison client.
- Keep every model thread and its context isolated. Never send one model's answer to another model.
- Keep the workspace bounded: at most 17 model panes plus one composer, with no overlap or overflow.
- Treat provider capabilities as provider- and model-specific. Unknown support is not supported support.
- Browser preview mode must remain local and must never make real provider requests.

## Security invariants

- API keys may only be handled by Rust and Windows Credential Manager.
- Never place secrets in React state, SQLite, logs, diagnostics, fixtures, screenshots, or `.aipin` files.
- All remote endpoints require HTTPS. Plain HTTP is only allowed for localhost loopback.
- Chat POST redirects remain disabled and authentication headers never cross origins.
- AI output is untrusted input: keep Markdown sanitization and remote-script restrictions intact.

## Engineering workflow

- Read `README.md`, `docs/ARCHITECTURE_AND_AGENT_GUIDE.md`, `PRODUCT.md`, and `DESIGN.md` before broad changes.
- Trace changes through React, Zustand, Tauri IPC, Rust, persistence, and tests.
- Preserve user changes and data compatibility; do not use destructive Git commands.
- Put dependencies, caches, temporary tools, recordings, and build artifacts in the project directory when practical. Avoid installing them on the system drive.
- Reuse existing types, design tokens, provider mapping, and store actions instead of creating parallel implementations.

## Required validation

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
```

Native window, Credential Manager, provider protocol, DPI, and tray changes also require an appropriate Windows-native check.
