---
name: workflow-skill-creator
description: Use when creating Android UI automation workflows, recording tap sequences, or building replayable device scripts. Triggers on tasks involving Android device interaction, accessibility selectors, or workflow-script.json files. Do NOT use for pure canvas games, OpenGL rendering, or custom drawing surfaces without standard UI elements.
---

# Workflow Skill Creator

**Core insight: Authoring is observable. Runtime is blind.**

During authoring, you see the device, probe selectors, and retry.
During runtime, the child skill cannot see the page and improvise.
Every decision you make must compensate for this asymmetry.

## Prerequisites

- Node.js 18+
- Connected Android device running the workflow agent on port 18185

## Mode

| Situation | Mode | Start |
|-----------|------|-------|
| No workspace | **New** | Phase 0 |

## Optimization Priority

| Priority | Objective | Meaning |
|----------|-----------|---------|
| 1 | **Stable generation** | Mother skill reliably produces a verifiable child skill |
| 2 | **Execution success** | Child skill runs correctly on the target device |
| 3 | **Generality** | System handles a wide range of task types |

When rules conflict, higher priority wins.

## Phase Flow

**Load references only when entering the phase that needs them.**

**Loading discipline:**
- During Phase 2 recording: **only load** recording-guide.md. Do not load compilation or delivery docs.
- During Phase 3 compilation: **only load** compilation-contract.md + compilation-checklist.md. Do not load recording docs.
- Load action-registry.md or engine-runtime.md only when encountering rare actions or debugging runtime errors.

| Phase | Type | What | Gate | Reference |
|-------|------|------|------|-----------|
| 0 | Gate | Collect inputs | All inputs confirmed | [admission-guide.md](references/admission-guide.md) |
| 1 | Gate | Init workspace | `init` succeeds | — |
| 2 | **Work** | Record steps | All walks accepted + last step verified | [recording-guide.md](references/recording-guide.md) |
| 3 | **Work** | Compile + review | quality-gate ≥ 90 | [compilation-contract.md](references/compilation-contract.md) + [compilation-checklist.md](references/compilation-checklist.md) |
| 4 | Gate | Package + deliver | Child skill package complete | [child-skill-guide.md](references/child-skill-guide.md) |

Additional references (load on demand):
- [engine-runtime.md](references/engine-runtime.md) — Engine schema during Phase 3 or 4
- [action-registry.md](references/action-registry.md) — API action parameters during Phase 2 or 3
- [tools.md](references/tools.md) — CLI commands and selector fields reference

## Principles

Three recording rules (walk-is-evidence, decide-before-walk, recover-by-walk) and selector discipline govern all phases. See [recording-guide.md](references/recording-guide.md) § Three Rules.

## Escalation Rules

STOP and ask the user when:

- Device unreachable after 2 retries → report connection issue
- Device locked or screen off during walk → report to user, ask to unlock
- App requires login and no credentials provided → ask user for credentials
- quality-gate score < 90 after 3 evidence repair cycles → root cause needs device re-recording
- Target element never found after scrolling entire page → task may be impossible on this app version
- App crashes repeatedly during recording → app may be unstable, report to user
- Rule 3 recovery fails after 3 walks → report state mismatch, ask user to restore

## Path Variables

Set both before running any command:
- `$SKILL_DIR` = this skill's install location (contains `scripts/`, `references/`, `agents/`). When loaded by an AI agent, resolve from the skill's own file path. Example: if SKILL.md is at `~/.claude/skills/workflow-skill-creator/SKILL.md`, then `$SKILL_DIR=~/.claude/skills/workflow-skill-creator`.
- `$DIR` = the workspace root created by `init` (e.g., `./my-skill`). All commands treat `--dir $DIR` as workspace root and access `$DIR/authoring/` internally — never pass the `authoring/` subdirectory as `--dir`.

All CLI commands use `node $SKILL_DIR/scripts/skill_cli.js` or `node $SKILL_DIR/scripts/device_cli.js`. Full command reference: [tools.md](references/tools.md).

## Phase 0: Admission

User provides task + device IP. Agent resolves everything else. Full guide: [admission-guide.md](references/admission-guide.md).

Do NOT proceed to Phase 1 until all inputs confirmed.

## Phase 1: Setup

```bash
node $SKILL_DIR/scripts/skill_cli.js init --dir $DIR --name <skill-name> --task "<task>" --base-url $BASE_URL --app <pkg> --app-name "<display-name>"
```

All parameters come from Phase 0 resolution. `init` resets device to home screen, grants all permissions to the target app, and captures initial checkpoint. The first recorded step validates against this checkpoint.

If the task starts from inside the app, the first recorded step should be `launch` with the target package — do NOT navigate manually before recording.

## Phase 2: Record

Full rules: [recording-guide.md](references/recording-guide.md).

```text
init → strategy → status (gives first walk command) → [ decide → walk → confirm ] × N
```

**Strategy first:** Before the first walk, analyze the task — classify each target (position vs identity vs dynamic), plan verify approach (static vs structural), determine shortest path. See recording-guide.md § Strategy.

Walk is the only device interaction during recording. All operations go through walk shortcuts: `--launch`, `--selector`, `--scroll`, `--key`. Mistakes are cheap: `walk --delete-step N`. Each walk returns a `diff` with `recommended_verify` and a ready-to-run `next` command.

Do NOT proceed to Phase 3 until all walks accepted and last step verified.

## Phase 3: Compile + Review

**Dispatching sub-agents:** Use your platform's subagent/tool capability (e.g., Claude Code `Agent` tool, Codex `task`). Pass:
- **Instructions:** the content of the agent's .md file (e.g., `agents/quality-reviewer.md`)
- **Context:** `"Review child skill artifacts in workspace: $DIR"`
- **Expected output:** `$DIR/authoring/quality-review.json`

If your platform does not support subagents, follow the .md file yourself (self-review fallback).

compile-view → compile-plan → compile-write → **quality-review** → quality-gate

`compile-write` is fully automated — generates the complete child skill package and validates it. `compile-plan` is a dry-run preview. The AI does not write workflow JSON manually. Details: [compilation-contract.md](references/compilation-contract.md).

**quality-review is a mandatory pipeline stage:**
- Default: dispatch [quality-reviewer](agents/quality-reviewer.md) sub-agent (isolated review, eliminates self-assessment bias)
- Fallback: if sub-agent unavailable, self-review against [compilation-checklist.md](references/compilation-checklist.md). Follow the same process and output format defined in [quality-reviewer.md](agents/quality-reviewer.md). Write the result to `$DIR/authoring/quality-review.json` with `"self_reviewed": true` added at root level.

**quality-gate expects** `$DIR/authoring/quality-review.json` with `overall_score` at JSON root level:
```json
{"verdict":"PASS","overall_score":95,"layers":{...},"fix_suggestions":[...]}
```

**Score < 90 → Evidence Repair Loop** (no device needed):

1. Read `fix_suggestions` from quality-review.json
2. For each issue, read the step's dump file (`authoring/dumps/step{N}_after.dump.txt`)
3. Fix from evidence:
   - Selector stacked unnecessary fields → confirm single field is unique in dump, `repair --step N --selector`
   - Dynamic data as selector (filename, timestamp) → find position or structural alternative in dump, `repair --step N --selector`
   - Verify only works under recording conditions → find structural proof in dump, `repair --step N --verify`
   - Exploration waste steps → `repair --delete-step N`
4. `compile-write` → `quality-review` → `quality-gate`
5. If still < 90 and issues marked "insufficient evidence" → re-record **only** those specific steps on device

**Repair command:** `repair --dir $DIR --step N --selector '...'` / `--verify '...'` / `--delete-step N`. Modifies session.json without device. See [tools.md](references/tools.md).

## Phase 4: Deliver

Generate child skill package per [child-skill-guide.md](references/child-skill-guide.md).

The package includes `SKILL.md`, `assets/workflow-script.json`, `assets/business-spec.json`, `scripts/run.js`, and `agents/openai.yaml`. The user is responsible for running and verifying the child skill on their device.
