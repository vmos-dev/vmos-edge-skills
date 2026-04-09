# Tools Reference

Full flag documentation for `skill_cli.js` and `device_cli.js`. Load on demand during recording or debugging — the main SKILL.md has the quick-ref tables for normal use.

## Quick Reference Tables

**Recording (Phase 2):**

| I want to... | Command |
|-------------|---------|
| Read screen (first step / recovery) | `node $SKILL_DIR/scripts/device_cli.js snapshot` |
| Record a click step | `node $SKILL_DIR/scripts/skill_cli.js walk --selector '{"text":"<label>"}' --intent-type navigate` |
| Record a non-click step | `node $SKILL_DIR/scripts/skill_cli.js walk --action '{"path":"...","params":{...}}' --intent-type navigate` |
| Set verify from changes | `node $SKILL_DIR/scripts/skill_cli.js confirm --step N --verify '...'` |
| Check progress + checkpoint | `node $SKILL_DIR/scripts/skill_cli.js status` |

**walk shortcuts:** For clicking an element, use `--selector '{"text":"<label>"}'` (auto-builds `accessibility/node` click action). For non-click actions (launch, scroll, text input), use `--action` with full API format from [action-registry.md](action-registry.md).

**Repair:**

| I want to... | Command |
|-------------|---------|
| Delete a failed step | `node $SKILL_DIR/scripts/skill_cli.js walk --delete-step N` |
| Fix a step's action | `node $SKILL_DIR/scripts/skill_cli.js walk --fix-step N --action '...'` |
| Insert a step after N | `node $SKILL_DIR/scripts/skill_cli.js walk --insert-after N --action '...'` |

**Compiling (Phase 3):**

`compile-view` → `compile-plan` → `compile-write` → `quality-gate` — run in order.

**Post-recording:** `node $SKILL_DIR/scripts/device_cli.js probe` — runtime verification (blind execute + check). Use after recording is complete, not during.

**Debug (not part of recording flow):** `node $SKILL_DIR/scripts/device_cli.js act`, `scroll`, `launch`, `key` — execute without recording. Run `--help` for details.

---

## Parameter Quick Reference

**Unified parameter conventions:**

- **`--action`** — `walk`, `act`, and `probe` use the same full API JSON: `{"path":"...","params":{"selector":{...},"action":"click"}}`
- **`walk --selector`** — shortcut for click: auto-builds `accessibility/node` click action
- **`--code`** — `key` command uses `--code` (e.g. `--code 4` for BACK, `--code 3` for HOME)

---

## Contents

1. [skill_cli.js](#skill_clijs)
2. [device_cli.js](#device_clijs)
3. [Internal / Debug Commands](#internal--debug-commands)

## skill_cli.js

All commands require `--dir $DIR`.

### `init` — Create a new authoring workspace

```bash
node scripts/skill_cli.js init --dir $DIR --name <name> --task "<task>" --base-url <url> --app <package> --app-name <name>
```

| Flag | Required | Description |
|------|----------|-------------|
| `--name` | Yes | Skill name (derived by agent from task in Phase 0) |
| `--task` | Yes | Human-readable task description |
| `--base-url` | Yes | Device API base URL (`http://<ip>:18185/api`) |
| `--app` | Yes | Target app package name (resolved by agent via `packages` in Phase 0) |
| `--app-name` | Yes | App display name (resolved by agent via `packages` in Phase 0) |
---

### `walk` — Execute one step and record evidence

```bash
node scripts/skill_cli.js walk --dir $DIR --action '<JSON>' --description "..."
```

**Core flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--action` | Yes* | Action JSON — same format as `workflow-script.json` actions |
| `--description` | Yes | Human-readable description of what this step does |

*Shortcuts (use instead of `--action`):
- `--selector '<JSON>'` — click: auto-builds `accessibility/node` click action
- `--scroll <direction>` — scroll: auto-calculates `scroll_bezier` coordinates from screen size. Direction: `up`/`down`/`left`/`right`
- `--launch <package>` — launch: auto-builds `activity/launch_app` action
- `--key <name|code>` — key event: accepts names (`BACK`, `HOME`, `ENTER`) or numeric codes
- `--input "<text>" --target '<selector>'` — text input: auto-builds `accessibility/node` set_text action

**Semantic hints** (recording-time decisions — compiler preserves, does not reclassify):

| Flag | Values | When to use |
|------|--------|-------------|
| `--intent-type` | `launch \| navigate \| seek \| reveal \| act \| verify \| macro \| handler` | Every step — classifies semantic role (validated) |
| `--verify-selector` | `'<selector JSON>'` | Step changes page state — proof element visible after change |
| `--as-handler` | `<name>` | Step may not be needed on every run (conditional dialogs, optional prompts) |
| `--loop` | `'<JSON>'` | Target needs multiple attempts; accepts `'{"max_count":5,"interval":800}'`. **Note:** compiler auto-derives loops from recorded evidence — usually not needed during recording |
| `--success-condition` | `'<JSON>'` | Custom completion: `{"type":"selector_found","selector":{...}}` |
| `--postcondition-page-id` | `<page-id>` | Expected page ID after step (warns if mismatch) |
| `--retry-policy` | `'<JSON>'` | Override timing: `{"wait_timeout":ms,"barrier_sleep":ms}` |
| `--throw-if-empty` | _(flag)_ | Fail the step if the selector finds no nodes |
| `--is-verify-step` | _(flag)_ | Mark this step as a verification-only step (no side effects) |

**Note:** `walk` reads `--base-url` from the session created by `init`. You do not need to pass `--base-url` on every walk command.

**Repair flags** (one at a time — only for repairing existing recordings):

| Flag | Description |
|------|-------------|
| `--delete-step N` | Remove step N from the recording |
| `--fix-step N` | Replace step N with the current `--action` |
| `--insert-after N` | Insert new step after step N |
| `--as-handler <name>` | Reclassify existing step N as a handler |

---

### `status` — Show session progress

```bash
node scripts/skill_cli.js status --dir $DIR
```

No additional flags. Shows recorded steps, evidence files, session metadata, and **checkpoint** (after-state of last confirmed step — use for Rule 3 recovery).

---

### `compile-view` — Output compile contract JSON

```bash
node scripts/skill_cli.js compile-view --dir $DIR
```

Outputs the full `compiler_view` object: `goal`, `steps[*].locked_evidence`, `steps[*].compiler_hints`, `recoveries[*]`. This is the input to compilation — treat it as the source of truth, not a recording transcript.

---

### `compile-plan` — Validate evidence and generate compilation strategy

```bash
node scripts/skill_cli.js compile-plan --dir $DIR
```

Validates that all recorded steps have sufficient evidence for blind-runtime compilation. Returns a compilation plan JSON with per-step hardening decisions.

If validation fails: fix the recording (re-record steps with better selectors or add verify) and re-run. Common failure: missing verify_selector on terminal step.

---

### `repair` — Evidence-based session repair (Phase 3)

```bash
node scripts/skill_cli.js repair --dir $DIR --step N --selector '<json>'
node scripts/skill_cli.js repair --dir $DIR --step N --verify '<json>'
node scripts/skill_cli.js repair --dir $DIR --step N --intent-type <type>
node scripts/skill_cli.js repair --dir $DIR --delete-step N
```

Modify session step data without device connection. Used in Phase 3 when quality-gate fails — fix selectors, verify, or delete steps from existing dump evidence.

| Operation | Flag | Effect |
|-----------|------|--------|
| Change action selector | `--step N --selector '<json>'` | Replaces the action's selector in session |
| Change verify selector | `--step N --verify '<json>'` | Replaces verify and sets status to confirmed |
| Change intent type | `--step N --intent-type <type>` | Updates the step's intent classification |
| Delete step | `--delete-step N` | Removes step and renumbers remaining steps |

---

### `quality-gate` — Enforce quality-reviewer score ≥ 90

```bash
node scripts/skill_cli.js quality-gate --dir $DIR
```

Reads `authoring/quality-review.json` (written by the quality-reviewer agent) and enforces the quality gate.

- Exits successfully if `overall_score ≥ 90`
- Throws with score and issue list if `overall_score < 90`
- Throws if `quality-review.json` is missing (quality-reviewer not yet run)

**Run this immediately after quality-reviewer confirms score ≥ 90** — before proceeding to delivery.

---

### `compile-write` — Generate the child skill package

```bash
node scripts/skill_cli.js compile-write --dir $DIR
node scripts/skill_cli.js compile-write --dir $DIR --with-evals
```

| Flag | Description |
|------|-------------|
| `--with-evals` | Generate eval structure (`evals.json`). Accepts: true/false/yes/no/1/0 |

`compile-write` is fully automated: it runs all compiler passes (normalize → merge scrolls → harden transitions → validate), generates the complete child skill package, and validates it. The AI does not write workflow JSON manually.

Generates: `assets/workflow-script.json`, `assets/business-spec.json`, `SKILL.md`, `scripts/run.js`, `agents/openai.yaml`.

Output files are written to `$DIR`:
- `$DIR/assets/workflow-script.json` — runtime workflow payload
- `$DIR/assets/business-spec.json` — business metadata
- `$DIR/SKILL.md` — child skill AI interface
- `$DIR/scripts/run.js` — runtime adapter

The `$DIR/authoring/` subdirectory contains recording-time data (snapshots, session, reports) and is NOT part of the shipped child skill package.

---

## device_cli.js

All commands require `--base-url $BASE_URL`.

### `snapshot` — Visible-area accessibility dump

```bash
node scripts/device_cli.js snapshot --base-url $BASE_URL
```

Returns all elements currently visible on screen in an indented tree structure, plus the foreground activity. Pure observation — does not change device state. During recording, use only for the first step (no prior walk output) or after Rule 3 recovery. For subsequent steps, use the previous walk's `diff` + `recommended_verify` as evidence.

**Output format:**
```json
{
  "package_name": "com.android.settings",
  "top_activity": "com.android.settings.Settings",
  "dump": "Screen 1080x2400 rotation=0\n[0] android.widget.FrameLayout ...\n  [0] android.widget.TextView text=\"Network & internet\" ...\n  [1] android.widget.TextView text=\"Display\" ..."
}
```

`dump` contains the full visible-area hierarchy with all attributes (text, resource_id, content_desc, bounds, clickable, etc.). Use this to understand the current page and choose selectors for `walk`.

---

### `packages` — List installed packages

```bash
node scripts/device_cli.js packages --base-url $BASE_URL
node scripts/device_cli.js packages --base-url $BASE_URL --type all
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--type` | No | `"user"` | `"all"`, `"system"`, or `"user"` |

Returns `{ type, count, packages[] }` where each package has `package_name`, `app_name`, `version_name`, etc. **Phase 0 key tool:** use this to auto-resolve `--app` and `--app-name` when the user only provides a task description — match `app_name` against the task to identify the target app.

---

## Internal / Debug Commands

These are NOT part of the recording flow. During recording, use only `snapshot` (first step/recovery), `walk`, `confirm`, and `status`.

| Command | Category | Purpose |
|---------|----------|---------|
| `device_cli.js act` | Debug | Execute an action without recording |
| `device_cli.js launch` | Debug | Launch an app by package name |
| `device_cli.js key` | Debug | Send a keycode event HOME=3, BACK=4 |
| `device_cli.js scroll` | Debug | Scroll without recording |
| `device_cli.js identify-page` | Debug | Match current screen against saved page snapshots |
| `device_cli.js probe` | Post-recording | Runtime verification: blind execute action and check result |

---

## Selector Fields

| Field | Type | Regex | Description |
|-------|------|-------|-------------|
| `text` | string | Yes | Visible text on the element |
| `content_desc` | string | Yes | Accessibility content description |
| `resource_id` | string | No | Android resource ID (e.g. `com.app:id/button`) |
| `class_name` | string | No | Widget class (e.g. `android.widget.Button`) |
| `xpath` | string | — | XPath expression (highest priority) |
| `index` | int | — | Child index for positional targeting |
| `clickable` | bool | — | Filter by clickable state |
| `enabled` | bool | — | Filter by enabled state |
| `scrollable` | bool | — | Filter by scrollable state |

**Selector priority:** Choose the most stable field for the element. Prefer `content_desc` or `resource_id` over `text` when available — they are less likely to change across locales.
