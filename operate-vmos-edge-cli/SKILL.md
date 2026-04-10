---
name: operate-vmos-edge-cli
description: Use when a task involves VMOS Edge Desktop — creating or controlling Android virtual devices on edge hosts, interacting with the Electron desktop UI via CDP, automating device workflows with YAML playbooks or batch JSON, or recovering from CLI error codes.
---

# Operate VMOS Edge CLI

## Overview

CLI tool for controlling the VMOS Edge Desktop Electron app — manage Android virtual devices on edge hosts, automate the desktop UI via CDP, and orchestrate device workflows.

## When to Use

- Creating, starting, stopping, or deleting Android virtual devices on edge hosts
- Automating the VMOS Edge Desktop Electron UI via CDP
- Writing YAML playbooks or batch JSON for device workflows
- Recovering from `vmos-edge-cli` error codes
- Installing or verifying the `vmos-edge-cli` tool

**Not for:** raw ADB commands, Appium, Android Studio emulators, or any non-VMOS Android tooling.

## Preflight

**GATE — complete before any other command. Do not skip.**

```bash
# 1. Node.js 18+ required
node --version

# 2. Check CLI
vmos-edge-cli --version

# 3. If CLI missing → install
npm i -g @vmosedge/cli

# 4. Verify
vmos-edge-cli schema
```

| Check fails | Action |
|-------------|--------|
| `node` not found | **Stop.** Tell user to install Node.js 18+. |
| `npm` not found | **Stop.** Tell user to install npm (bundled with Node.js). |
| `vmos-edge-cli` not found | Run `npm i -g @vmosedge/cli`, then verify with `schema`. |
| `schema` fails after install | Report error and **stop**. Do not improvise fallbacks. |

Do not substitute `node dist/main.js`, `pnpm build`, or `pnpm link`. The only supported install path is `npm i -g @vmosedge/cli`.

The manual steps above and the automated script (`scripts/ensure-installed.mjs`) run the same flow — use either. See [invocation-preflight.md](references/invocation-preflight.md) for platform paths and edge cases.

## Critical Rules

1. **ALWAYS `ui state` to inspect, NEVER `screenshot`** — `state` is free and structured. `screenshot` costs vision tokens. Only screenshot when user asks to save an image.
2. **ALWAYS `ui click`/`type` to interact, NEVER `eval` to click/type** — `eval` bypasses scroll and CDP fallback, fails on off-screen elements.
3. **ALWAYS `ui state` after page changes** — after `click`, `goto`, `back`. Never reuse stale indices.
4. **ALWAYS batch consecutive safe actions** — if each step is safe regardless of others' results, batch them. Never run them as separate calls.
5. **NEVER mix mutating commands in one batch** — `create`, `delete`, `start`, `stop`, `reset` each as a separate direct call. Check result before issuing the next command. One command *may* target multiple items (`device start id1 id2`, `--count 5`) — the boundary is between commands, not between targets.
6. **ALWAYS `schema` before writing batch/YAML** — never guess param names. Positional CLI args have different names in batch/YAML that are not guessable. Run `schema <domain>` to discover exact names and types.
7. **Every `device`/`image` command needs `--host <ip>`** — `host` commands take `<ip>` as positional arg.

## Core Workflow

The app stays running between commands — no need to `app start` every time.

1. **Preflight** → see Preflight section above. Must pass before continuing.
2. **Inspect** → `ui state`, `device list`, `host info`, etc.
3. **Act** → direct for single/mutating, batch for consecutive safe actions, run for reusable flows
4. **Parse** → success: read `data`. Failure: branch on `code` (see [error-recovery.md](references/error-recovery.md))
5. **Verify** → `ui state` after page changes, `ui form-state` after typing, `device info` after mutations

## Quick Reference

| Context | Format | Example |
|---------|--------|---------|
| Terminal | `vmos-edge-cli <domain> <method>` | `vmos-edge-cli ui eval "1+1"` |
| YAML `action:` | `domain.method` | `action: ui.eval` |
| `batch` JSON | `domain.method` | `{"action":"ui.eval"}` |
| YAML variable | `${{ expr }}` | `${{ devices[0].id }}` |
| `batch` variable | `$expr` | `$devices[0].id` |

Terminal uses spaces. YAML and batch use dots. Variable syntax is not interchangeable.

## Reference Map

Use the Read tool on these files when the condition applies — do not work from memory.

- [references/page-map.md](references/page-map.md) — **read first** when navigating the desktop UI: page routes, hidden features, how to reveal menus/panels/dialogs
- [references/command-patterns.md](references/command-patterns.md) — three invocation modes (direct / batch / run), full command reference
- [references/ui-automation.md](references/ui-automation.md) — element selection, action list, cost guide
- [references/error-recovery.md](references/error-recovery.md) — error codes and deterministic recovery
- [references/invocation-preflight.md](references/invocation-preflight.md) — automated helper script, platform paths, install edge cases

## Common Pitfalls

| Mistake | Fix |
|---------|-----|
| `ui screenshot` to inspect page | Use `ui state` — free, structured, has `[N]` indices |
| `ui eval "el.click()"` | Use `ui click <N>` — handles scroll + CDP fallback |
| Reuse indices after page navigation | Run `ui state` again to get fresh indices |
| `host check 10.0.0.5` then `host info 10.0.0.5` as 2 calls | Batch them: one call, both safe to run unconditionally |
| Guess batch/YAML param names from CLI syntax | Positional args have different names. Run `schema <domain>` first |
| `device create` then `device start` in one batch | Never — different mutating commands must be separate calls |
| Type into field without verifying | `ui form-state` after typing to confirm value |
| `app start` on every command | App persists — check `app status` first |
| `ui state` output too long on complex page | `ui state --interactive-only`, or batch with `interactiveOnly: true` |
| Skip preflight, run CLI commands directly | CLI may not be installed. **Always** run Preflight gate first |
