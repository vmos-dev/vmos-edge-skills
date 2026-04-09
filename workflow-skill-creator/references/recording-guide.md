# Recording Guide

Phase 2 complete reference. Each step: decide from evidence → walk → confirm from diff.
**Scope:** Load when entering recording phase. Do NOT load compilation or engine references during this phase.

---

## Three Rules

1. **Walk Output = Evidence** — Each walk returns a `diff` (what changed) + `recommended_verify` + `next` command. This is the evidence for the next step. Only use `snapshot` for the first step or after Rule 3 recovery.
2. **Decision Before Walk** — Before every walk, determine: action selector, intent type, expected verify signal. If unclear, review evidence — never trial-execute.
3. **Recovery by Walk** — Unexpected result → delete wrong step → walk corrective → delete corrective. 3 attempts failed → escalate to user.

---

## Strategy

Before the first walk, analyze the task and plan your selector approach. Do NOT start recording until strategy is clear.

**Task decomposition:** Break the task into operations. Identify each operation's target.

**Target classification:** Ask one question per target: **"Would this selector match the same element on the next run?"**

| If the target is... | Then use... | Because... |
|---------------------|-------------|------------|
| Described by position ("first", "last", "Nth") | `index` | Position is stable across runs; content changes |
| An app-fixed label ("Settings", "Display") | `text` or `content_desc` | App labels don't change between runs |
| User-generated content (filename, message, timestamp) | **Never as selector** — use position or structure | Content is unique to this run |
| A UI control (back, menu, search) | `content_desc` or `resource_id` | Framework controls are structurally stable |

**Verify strategy:** Ask: **"Would this verify still pass if the data on screen is different?"**

| If the page content is... | Then verify by... |
|---------------------------|-------------------|
| Fixed by the app (menu items, section headers) | Element text |
| Variable across runs (file lists, messages, counts) | Page structure, action result, or state change — not specific content |

**Path planning:** Determine the shortest path before walking. Read the first dump to understand navigation structure — do not explore by trial-and-error.

**Reusability self-check:** Before every walk, ask: "If I delete this workspace and run the child skill tomorrow, will this step still work?" If the answer depends on today's data → change the selector strategy.

---

## Recording Flow

```
init → [ decide → walk → confirm ] × N
```

### Evidence Sources

| Situation | Evidence source |
|-----------|----------------|
| First step | Run `status` — it gives the exact first walk command with the app package pre-filled |
| Subsequent steps | Previous walk's `diff` + `recommended_verify` |
| Need more detail | Read `authoring/dumps/step{N}_after.dump.txt` — annotated with `+` (new), scores, and capability tags |
| Walk rejected | Previous evidence still valid (device untouched) |
| Walk executed but failed | Walk's own `diff` (device WAS touched, previous evidence expired) |
| After Rule 3 recovery | Fresh `snapshot` |
| After `walk --delete-step` | Predecessor's walk output, or `snapshot` if step 1 deleted |

---

## Decide

Before each walk, determine all parameters from evidence (Rule 2):

| Decision | Source | Required |
|----------|--------|----------|
| Action selector | Evidence dump — strongest unique field with `[tap]` marker | Always |
| Selector stability | Score > 10 | Always |
| Intent type | Business logic | Always |
| Proof strategy | Predicted changes | Always |
| Expected verify signal | What `+` elements should appear in walk `diff` | Always |
| Input precondition | Current field value from evidence | If text input |

**Any decision unclear → review evidence again. Do not walk.**

---

## Walk

### Commands

All walk/confirm/status commands use: `node $SKILL_DIR/scripts/skill_cli.js <command> --dir $DIR [options]`

```bash
# Launch app
walk --dir $DIR --launch com.android.settings --intent-type launch --description "Launch Settings"

# Click element
walk --dir $DIR --selector '{"text":"Settings"}' --intent-type navigate --description "Tap Settings"

# Scroll
walk --dir $DIR --scroll down --intent-type seek --description "Scroll down to find target"

# Text input
walk --dir $DIR --input "hello" --target '{"resource_id":"com.app:id/input"}' --intent-type act --description "Enter text"

# Key event
walk --dir $DIR --key BACK --intent-type navigate --description "Press Back"
```

All shortcuts are resolved by `action_resolver.js`. Use `--action '<JSON>'` for raw API calls not covered by shortcuts.

### Walk Return Value

Walk returns a compact JSON designed for quick decision-making:

```json
{
  "step": 2,
  "success": true,
  "verify_status": "pending",
  "page_changed": true,
  "activity": "com.android.settings.SubSettings",
  "diff": [
    { "s": "+", "selector": { "text": "Dark theme" }, "score": 100 },
    { "s": "+", "selector": { "text": "Screen timeout" }, "score": 100 },
    { "s": " ", "selector": { "resource_id": "com.android.settings:id/toolbar" }, "score": 60 },
    { "s": "-", "selector": { "text": "Network & internet" } }
  ],
  "recommended_verify": { "text": "Dark theme" },
  "next": "confirm --dir $DIR --step 2 --verify '{\"text\":\"Dark theme\"}'"
}
```

| Field | Description |
|-------|-------------|
| `step` | Recorded step number |
| `success` | Whether the action executed |
| `verify_status` | `pending` (needs confirm) or `confirmed` |
| `page_changed` | Whether the page/activity changed |
| `activity` | Current foreground activity |
| `diff` | Unified page diff — `+` new, ` ` unchanged, `-` removed. `+` items include `score` |
| `recommended_verify` | Highest-scoring `+` element — use this for confirm unless business logic says otherwise |
| `next` | Ready-to-run confirm command (or guidance if no candidates) |

**Reading `diff`:** `+` elements appeared after the action and are verify candidates. Pick the one that proves the **business goal** of this step, not just any new element. `recommended_verify` is usually the right choice.

### Repair Flags

| Flag | Purpose |
|------|---------|
| `--delete-step N` | Remove step N |
| `--fix-step N` | Replace step N with current action |
| `--insert-after N` | Insert new step after step N |

### Rejection Rules

Walk rejects immediately — device NOT touched, previous evidence still valid. Fix and retry.

| Rejection | Cause | Fix |
|-----------|-------|-----|
| Action selector score ≤ 10 | Selector too weak | Use stronger selector (resource_id/content_desc) |
| `--verify-selector` score ≤ 10 | Proof selector too weak | Use stronger verify selector |
| Obfuscated resource_id | Leaf ≤3 chars, or ≤4 chars containing a digit | Switch to `content_desc` or `text` |
| Coordinate click without `--verify-selector` | No independent proof | Add `--verify-selector` |

### Settle Detection

After each walk action, the system automatically samples the screen (1-3s) to detect page stability. `observed_settle_ms` is consumed by the compiler. If `pageStable = false`, the page may still be loading — wait briefly or take a fresh snapshot.

---

## Confirm

**Pick verify selector from walk output:**

Use `recommended_verify` from walk output — it is the highest-scoring new element. Override only if a different `+` element better proves the business goal.

A good verify selector is:
- Unique to destination page (`+` in diff, not ` `)
- Stable (app-controlled text or content_desc)
- Proves the business goal of this step

```bash
confirm --dir $DIR --step N --verify '{"text":"Network & internet"}'
```

- If `--verify-selector` was passed on the walk command → no separate confirm needed.
- **No proof found → repair:** delete step (`walk --delete-step N`), do not confirm with weak selector.
- For full element list beyond what `diff` shows, read `authoring/dumps/step{N}_after.dump.txt`.

### Dump Capability Tags

After dumps are annotated with interaction capabilities derived from the UI hierarchy:

| Tag | Meaning | Inherited from parent? |
|-----|---------|----------------------|
| `[tap]` | Element or ancestor is clickable — safe to use as walk click target | Yes |
| `[long]` | Element or ancestor is long-clickable | Yes |
| `[scroll]` | Element is a scrollable container — use `--scroll` within its bounds | No (container only) |
| `[input]` | Text input field (EditText) — use `--input` to type | No (field only) |
| `[disabled]` | Element is disabled (`enabled=false`) — do NOT interact | Overrides all |

**Decision rules:**
- For click targets: pick elements with `[tap]`
- For text input: pick `[input]` elements, use `--input` shortcut
- For scrolling: `--scroll down` scrolls the main viewport. If the page has multiple `[scroll]` containers and you need to scroll a specific one, use `--action` with explicit coordinates from the container's bounds
- Elements without capability tags are display-only — use as verify candidates, not action targets

---

## Intent Type

| Type | When | verify-selector |
|------|------|-----------------|
| `launch` | Open target app (MUST use `activity/launch_app`, never click icon) | **Required** |
| `navigate` | Page transition (click UI element) | **Required** |
| `act` | Business state change (not page transition) | **Required** |
| `seek` | Scroll to find off-screen target | Optional |
| `reveal` | Wait for async content to appear | Optional |
| `verify` | Inspect without changing state | Optional |
| `macro` | Deliberate fixed-count repetition | Optional |
| `handler` | Optional interruption (permission dialog, crash dialog) | Optional |

**Disambiguation:**
- `macro` = repeat N times (fixed count) | `seek` = stop when found | `reveal` = stop when visible
- `launch` = start app via `activity/launch_app` | `navigate` = page transition within running app
- `act` = changes state → postcondition proves change | `verify` = read-only assertion

---

## Selector Rules

**Score ≤ 10 → walk auto-rejects.** Obfuscated resource_id (leaf ≤3 chars or ≤4 chars with digit), class_name alone, and coordinates are rejected.

**Action vs proof use different priorities:**
- **Action** (what to tap): `resource_id` > `content_desc` > `text` (stability)
- **Proof** (what proves success): `text` > `content_desc` > `resource_id` (business visibility)

**Rules:**
- Single stable unique field — do not stack fields once one is unique
- `index` for positional intent only, not for disambiguation
- `clickable` is not a selector field — it's a locator filter

For full selector field reference, see [tools.md](tools.md) § Selector Fields.

---

## Proof Strategy

| Action type | What proves success |
|-------------|---------------------|
| Page transition (launch, navigate) | Element unique to destination, absent from source |
| Same-page state change (toggle, input) | Property delta (enabled, checked, text) |
| Scroll / reveal | Target becomes visible |
| Handler dismissal | Return to prior business page |
| **Terminal step** | **Business goal achieved** — not just last action ran |

---

## Handler Classification

Transient interruption pattern — apply three causality tests:

| Test | Question | If suggests interruption |
|------|----------|--------------------------|
| **Direct consequence** | Does this page ALWAYS appear after the preceding action? | No → possibly handler |
| **Independence** | Could this page appear at ANY point? | Yes → handler candidate |
| **Goal necessity** | Can the business goal be achieved WITHOUT dismissing this? | Yes → handler candidate |

All 3 pass → record as `--as-handler <name> --intent-type handler`
Any test fails → keep in main flow

---

## Error Recovery

**Checkpoint:** The after-state of the last confirmed step (via `status` command). First step checkpoint = init state.

**Rule 3 — Recovery steps:**

1. `walk --delete-step N` — remove the wrong step
2. Walk corrective action(s): wrong page → `key(BACK)`, input filled → `clear_text`, dialog opened → dismiss
3. `walk --delete-step` each corrective step (not business steps)
4. Verify corrective walk output matches checkpoint
5. Not restored after 3 recovery walks → escalate to user

**Handler exception:** If mismatch is a known handler (permission/crash dialog), record as `--as-handler` instead.

---

## Terminal Verification

The last recorded step MUST have a `verify_selector` that proves the business goal — not just that the last action ran. If the verify only proves page arrival but not task completion, record one more step. Do NOT proceed to Phase 3 until this is satisfied.

---

## Red Flags

If any of these thoughts arise, **stop and re-check**:

- "Selector works during recording, good enough" → Recording ≠ runtime; weak selector finds nothing at runtime
- "Page looks stable now" → Visual stability ≠ DOM stability; wait for settle detection
- "This resource_id is unique enough" → Unique on this device ≠ unique on all devices
- "Almost done, skip quality-gate" → Missing terminal verify = child skill falsely reports success
- "Too many steps, don't want to redo" → Sunk cost; bad steps compile into unpredictable runtime failures
- "Can't find element, use coordinates" → Coordinates drift across screen resolutions/densities

---

## Compiler Boundary

The compiler runs four deterministic passes after recording. Do NOT do these manually during recording:

| Pass | Agent must NOT do manually |
|------|--------------------------|
| 1. Normalize | Do not restructure walk output |
| 2. Merge scrolls | Do not add `--loop` during recording |
| 3. Harden transitions | Do not record sleep or verify-only steps |
| 4. Validate terminal | Do not add redundant verify steps — compiler validates terminal verify |
