# Invocation Preflight

The standard check-and-install flow is in the **Preflight** section of SKILL.md. This file covers the automated helper script, platform-specific paths, and edge cases.

## Automated Helper Script

Use `scripts/ensure-installed.mjs` for a deterministic check-install-verify flow across macOS, Windows, and Linux:

```bash
node scripts/ensure-installed.mjs
```

The script performs: Node.js version check → CLI detection → `npm i -g @vmosedge/cli` if missing → `schema` verification. Exit 0 = ready, non-zero = failed (read stderr).

## Platform Paths

Set `app.bin-path` before `app start` if the desktop app is not at the default location:

| Platform | Default path |
|----------|-------------|
| macOS | `/Applications/VMOS Edge 2.0.app` (auto-resolves to binary) |
| Windows | `C:\Program Files\VMOS Edge 2.0\VMOS Edge 2.0.exe` |
| Linux | `/opt/vmos-edge/vmos-edge` |

```bash
vmos-edge-cli config set app.bin-path "<path>"
```

## Edge Cases

- **Global install forbidden** — ask the user how they want the CLI made available (npx, local node_modules, etc.).
- **CLI installed but unhealthy** (`--version` exits non-zero) — report the error detail. Do not reinstall automatically.
- **Multiple Node versions** (nvm/fnm) — confirm the active version is 18+ before proceeding.

## Do Not

- Do not substitute `node dist/main.js` as a fallback.
- Do not use `pnpm build` or `pnpm link` as a substitute for `npm i -g @vmosedge/cli`.
- Do not hide bootstrap changes from the user; report whether CLI was already present or newly installed.
