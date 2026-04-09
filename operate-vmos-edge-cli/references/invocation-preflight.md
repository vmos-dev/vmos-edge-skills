# Invocation Preflight

## Goal

Get to an installed, callable `vmos-edge-cli` command.

Treat npm installation as the supported entry path. Do not substitute `node dist/main.js`, `pnpm build`, or `pnpm link` as the normal way to use the CLI.

## Preferred Tool

Use `scripts/ensure-installed.mjs` from this skill directory when installation status is unknown or when you want the check-and-install flow to stay deterministic across macOS, Windows, and Linux.

From the repository root:

```bash
node skills/operate-vmos-edge-cli/scripts/ensure-installed.mjs
```

If the CLI should be installed from a published npm package instead of the current repository:

```bash
node skills/operate-vmos-edge-cli/scripts/ensure-installed.mjs <package-name>
```

## Minimal Manual Flow

Check runtime prerequisites first:

```bash
node --version
npm --version
```

If either command is missing or broken, stop and tell the user that Node.js 18+ with npm is required first.

Then check the CLI:

```bash
vmos-edge-cli --version
```

If `vmos-edge-cli` is missing, install it with npm:

```bash
npm install -g .
```

If the user provides a published npm package name, install that package instead:

```bash
npm install -g <package-name>
```

Verify the installed CLI after installation:

```bash
vmos-edge-cli --version
vmos-edge-cli schema
```

## Agent Policy

- Detect `node` and `npm` first.
- Detect `vmos-edge-cli` next. Install only when the command is missing.
- Prefer `scripts/ensure-installed.mjs` over rewriting the check-and-install sequence inline.
- Report whether the CLI was already present or had to be installed.
- If Node.js or npm is missing, surface that prerequisite failure clearly and stop.
- If installation fails, surface the npm error and stop instead of improvising a repo-local fallback.
- If the task environment forbids global installation, ask the user how they want the CLI made available.

## Do Not

- Do not try to run the Node helper when `node` itself is unavailable.
- Do not try npm-based CLI installation when `npm` is unavailable.
- Do not assume the CLI is globally installed.
- Do not switch to `node dist/main.js` as a fallback.
- Do not use `pnpm build` or `pnpm link` as a substitute for installation.
- Do not hide bootstrap changes from the user; report whether you used an existing installation or a new npm installation.
