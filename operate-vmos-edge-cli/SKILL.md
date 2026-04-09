---
name: operate-vmos-edge-cli
description: Use when a task involves VMOS Edge Desktop — creating or controlling Android virtual devices on edge hosts, interacting with the Electron desktop UI via CDP, automating device workflows with YAML playbooks or batch JSON, or recovering from CLI error codes.
---

# Operate VMOS Edge CLI

Complete VMOS Edge tasks with the fewest reliable CLI commands.

## Critical Rules

1. **ALWAYS `ui state` to inspect, NEVER `screenshot`** — `state` is free and structured. `screenshot` costs vision tokens. Only screenshot when user asks to save an image.
2. **ALWAYS `ui click`/`type` to interact, NEVER `eval` to click/type** — `eval` bypasses scroll and CDP fallback, fails on off-screen elements.
3. **ALWAYS `ui state` after page changes** — after `click`, `goto`, `back`. Never reuse stale indices.
4. **ALWAYS batch consecutive safe actions** — if each step is safe regardless of others' results, batch them. Never run them as separate calls.
5. **ALWAYS direct for mutating actions** — `create`, `delete`, `start`, `stop`, `reset` one at a time. Check result before next.
6. **ALWAYS `schema` when unsure** — never guess params. `--kebab-case` → `snake_case` in batch/YAML.
7. **Every `device`/`image` command needs `--host <ip>`** — `host` commands take `<ip>` as positional arg.

## Core Workflow

The app stays running between commands — no need to `app start` every time.

1. **Ensure CLI** → `vmos-edge-cli --version` (if missing, read [invocation-preflight.md](references/invocation-preflight.md))
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

- [references/command-patterns.md](references/command-patterns.md) — three invocation modes (direct / batch / run), full command reference
- [references/ui-automation.md](references/ui-automation.md) — element selection, action list, cost guide
- [references/error-recovery.md](references/error-recovery.md) — error codes and deterministic recovery
- [references/invocation-preflight.md](references/invocation-preflight.md) — CLI missing or not installed yet

## Common Pitfalls

| Mistake | Fix |
|---------|-----|
| `ui screenshot` to inspect page | Use `ui state` — free, structured, has `[N]` indices |
| `ui eval "el.click()"` | Use `ui click <N>` — handles scroll + CDP fallback |
| Reuse indices after page navigation | Run `ui state` again to get fresh indices |
| `host check 10.0.0.5` then `host info 10.0.0.5` as 2 calls | Batch them: one call, both safe to run unconditionally |
| Guess batch param names from CLI flags | `--device-type` → `device_type`. Use `schema` when unsure |
| `device create` then `device start` in one batch | Never — `create` is mutating, check result first |
| Type into field without verifying | `ui form-state` after typing to confirm value |
| `app start` on every command | App persists — check `app status` first |
| `ui state` output too long on complex page | Use `interactiveOnly: true` via batch to filter non-interactive elements |
