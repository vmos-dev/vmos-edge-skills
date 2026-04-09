# Compilation Audit Checklist

**Scope:** Phase 3 reference. Load after compile-write for self-check or quality review.

All quality checks for compiled child skill artifacts. One standard, two uses:
- **Self-check:** executing agent runs this after compile-write, fixes failures before dispatching reviewer
- **Quality review:** quality-reviewer agent scores each item, produces verdict

## Audit Target Files

All files are relative to the child skill directory (`$DIR`). These are the **shipped artifacts** — review these, not authoring intermediates.

| File | What it contains | Used by checks |
|------|-----------------|----------------|
| `assets/workflow-script.json` | Runtime workflow: `steps`, `flow`, `exception_handlers` | P0 all, P1.1-1.7, P2.1-2.7 |
| `SKILL.md` | Child skill AI interface: frontmatter (name, description, app_name, package_name, scenarios), sections | P1.8-1.10, P3.3-3.5 |
| `assets/business-spec.json` | Runtime config: `name`, `runtime` (poll/timeout) | Name consistency check |

**`authoring/compile-report.json`** is NOT an audit target — it is an optional accelerator with pre-computed metrics. If available, use it to speed up checks; if absent, derive everything from the files above.

### `workflow-script.json` field paths

| Path | Description | Checked by |
|------|-------------|------------|
| `steps.<id>.actions[].path` | Action API path | 0.1 |
| `steps.<id>.actions[].throw_if_empty` | Must be `["nodes"]` array, at action level | 0.2 |
| `flow[]` | Ordered step IDs — must match `steps` keys, no duplicates | 0.3 |
| `steps.<id>.actions[].path` = `activity/launch_app` | Launch must use this, not click icon | 0.4 |
| last `flow` entry → `steps.<id>.actions[]` | Terminal step must have verify + throw_if_empty | 0.5 |
| `steps.<id>.actions[]` sequence | Sleep barrier between side-effect and verify | 1.1 |
| `steps.<id>.actions[].params.wait_timeout` | Timeout values | 1.2 |
| `steps.<id>.actions[].params.selector` | Verify selector quality and target | 1.3-1.5 |
| `steps.<id>.loop` | Scroll retry config | 1.6 |
| `exception_handlers[].selector` | Handler selector stability | 1.7 |
| `steps.<id>.actions[].params.selector` | Selector field stability | 2.1-2.6 |
| `steps.<id>.actions[].params.duration` | Sleep timing evidence | 2.7 |

### `SKILL.md` fields

| Field | Source | Checked by |
|-------|--------|------------|
| frontmatter `description` | `SKILL.md` | 1.8, 1.9, 1.10 — compare against step sequence |
| frontmatter `scenarios` | `SKILL.md` | 3.5 — trigger phrase variety |
| sections (Outcome, Trigger Phrases, etc.) | `SKILL.md` | 3.3, 3.5 |
| step descriptions | `workflow-script.json` `steps.<id>.description` | 3.1, 3.2, 3.6 |

---

## P0: Fatal Defects (any FAIL → overall FAIL, no score)

Structural errors that guarantee the child skill crashes or hangs. The compiler's `validateShippabilityPass` auto-checks most of these; the reviewer verifies independently.

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 0.1 | Action paths exist | All paths in known registry | Unknown action path |
| 0.2 | `throw_if_empty` format | Value is `["nodes"]`, at ActionConfig level, only on `accessibility/node` | Boolean value, inside params, or on non-node action → silently ignored |
| 0.3 | Flow completeness | All step IDs in flow exist in steps, no orphans | Missing or extra IDs |
| 0.4 | Launch method | Uses `activity/launch_app` with package_name | Clicks desktop icon |
| 0.5 | Terminal verify exists | Last step has verify action with `throw_if_empty` | No terminal verification → child skill can't confirm success |

**Rule:** Any single P0 FAIL → verdict is FAIL, overall_score is 0. Do not continue scoring.

---

## P1: Runtime Risk (weight 70% of total score)

Problems that will cause the child skill to fail on the target device during normal execution. Each FAIL deducts 10 points from the P1 score (base 100).

### Timing & Barriers

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 1.1 | Sleep barrier after side-effect | `base/sleep` between every side-effecting action and next verify | Missing → verify sees stale page |
| 1.2 | Timeout proportionality | Network/async operations use higher `wait_timeout` than local UI transitions | All steps use identical timeout |

### Verification Quality

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 1.3 | Verify proves the right thing | Verify element is unique to destination page, absent from source page | Element exists on both pages → proves nothing |
| 1.4 | Verify targets business content | Content element (text, label, heading) | UI container (toolbar, layout, frame) |
| 1.5 | Step continuity | Step N+1's action target is protected by Step N's verify | Step N verifies A, Step N+1 acts on unverified B |

### Control Flow

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 1.6 | Scroll-to-find has retry | seek/reveal step has `completed: "success"` + `loop.max_count` | Single-shot scroll → target below viewport = failure |
| 1.7 | Handler selector quality | Handler's dismiss selector is stable and its action is valid | Handler exists but selector is coordinate-based or ambiguous |

### Flow Completeness (AI semantic judgment)

These checks require understanding the business task, not just inspecting structure. Compare `SKILL.md` frontmatter `description` against the step sequence.

| # | Check | How to judge | FAIL |
|---|-------|-------------|------|
| 1.8 | Goal-terminal alignment | Does terminal verify directly prove the end-state described in the task? Not an intermediate state, not just "arrived at a page" — the actual business outcome | Terminal verify proves a waypoint, not the goal |
| 1.9 | Step chain coherence | For each pair of adjacent steps: is the transition logically possible without an intermediate step? If step N ends on page A and step N+1 acts on an element that only exists on page B, there's a missing navigation | Logical gap requiring an unrecorded navigation or action |
| 1.10 | Task decomposition coverage | Break the task description into its constituent operations. Does every operation have at least one corresponding step? | An operation mentioned in the task has no step |

### Reusability (AI semantic judgment)

These checks verify the child skill will work on the NEXT run, not just the recording run. A child skill that only works once is not shippable.

| # | Check | How to judge | FAIL |
|---|-------|-------------|------|
| 1.11 | Selector avoids run-specific data | Would this selector match the same target on a fresh run with different data? Filenames, timestamps, message text, counts are run-specific | Selector depends on data that only existed during the recording session |
| 1.12 | Terminal verify is condition-independent | Would the terminal verify pass if the data context is different (more items, fewer items, different items)? | Verify assumes a data state that is an artifact of the recording environment |
| 1.13 | Positional intent uses positional selector | When the task describes a target by position ("first", "last", "Nth"), does the selector use `index`? | Task specifies position but selector uses content identity |

**Judgment guidance for 1.8-1.13:**
- Read the task as a user would describe it, not as a developer would implement it
- These checks must be app-agnostic: judge by logical consistency, not by knowledge of specific apps
- For 1.11-1.13: ask "if I wipe this recording and run the child skill tomorrow, will this step still work?"
- A selector that only matches because of today's data → 1.11 FAIL
- A verify that only passes because of today's state → 1.12 FAIL
- A task that says "Nth" but targets by content → 1.13 FAIL

**P1 scoring:** `p1_score = 100 - (FAIL_count × 10)`. Minimum 0.

---

## P2: Fragility (weight 30% of total score)

Problems that won't break the child skill on the recording device but may cause failures on other devices, locales, or screen sizes. Each FAIL deducts 12 points, each WARNING deducts 6 points (base 100).

### Selector Stability

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 2.1 | Selector uses stable fields | `content_desc`, meaningful `resource_id`, app-controlled `text` | Obfuscated ID, coordinates, device-state text |
| 2.2 | Selector is minimal | Fewest fields needed for uniqueness | Extra fields that increase breakage surface |
| 2.3 | No generic framework IDs | App-specific resource_id | `android:id/title`, `android:id/summary` — shared across pages |
| 2.4 | Text is app-controlled | Menu labels, button text, section headers | Counts, user data, locale-dependent strings → WARNING |

### Verify Robustness

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 2.5 | Verify has no coordinates | Verify selectors use semantic fields only | `center_x`, `center_y`, `bounds` in verify selector |
| 2.6 | Repeat-run safety | Launch verify confirms expected start page | Only checks app launched → may land on leftover page |

### Timing Robustness

| # | Check | PASS | FAIL |
|---|-------|------|------|
| 2.7 | Sleep timing has evidence | Based on `observed_settle_ms` or user-set value | Round numbers with no source → WARNING |

**P2 scoring:** `p2_score = 100 - (FAIL_count × 12) - (WARNING_count × 6)`. Minimum 0.

---

## P3: Quality Issues (no score impact, advisory only)

Issues that don't affect runtime behavior but reduce maintainability and professionalism. Output as warnings in the review.

| # | Check | WARNING condition |
|---|-------|-------------------|
| 3.1 | Description language consistency | Mixed languages in step descriptions |
| 3.2 | Description uses business language | Uses action paths or step numbers instead of business outcomes |
| 3.3 | SKILL.md format complete | Missing Outcome, Trigger Phrases, or Runtime Contract sections (Failure Modes is optional) |
| 3.4 | SKILL.md description format | Description is empty or missing |
| 3.5 | Trigger phrases varied | Only one trigger phrase |
| 3.6 | Step keys are semantic | Uses `step_1` instead of `launch_settings` |

**P3 items produce warnings in the review output but do not affect the score or verdict.**

---

## Scoring Formula

```
IF any P0 item is FAIL:
  verdict = "FAIL"
  overall_score = 0

ELSE:
  p1_score = max(0, 100 - P1_FAIL_count × 10)
  p2_score = max(0, 100 - P2_FAIL_count × 12 - P2_WARNING_count × 6)

  overall_score = round(p1_score × 0.7 + p2_score × 0.3)

  IF overall_score >= 90: verdict = "PASS"
  IF overall_score >= 70: verdict = "NEEDS_REPAIR"
  IF overall_score <  70: verdict = "FAIL"
```

**Why this formula:**
- P0 is a hard gate — fatal defects are non-negotiable
- P1 (runtime risk) has 70% weight — if it won't run, nothing else matters
- P2 (fragility) has 30% weight — cross-device issues are real but secondary
- P3 (quality) has 0% weight — bad descriptions shouldn't block delivery

**Thresholds:**
- ≥ 90: Ship-ready
- 70-89: Evidence repair needed — fix from existing dumps, recompile
- < 70: Likely needs device re-recording for affected steps
