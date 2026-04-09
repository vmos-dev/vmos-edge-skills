# Compilation Contract

**Scope:** Phase 3 reference. Load when entering compilation phase. For recording decisions, see [recording-guide.md](recording-guide.md).

Load on demand during this phase:

- Engine runtime schema: [engine-runtime.md](engine-runtime.md)
- API action parameters: [action-registry.md](action-registry.md)
- Post-compile self-check: [compilation-checklist.md](compilation-checklist.md)

---

## Compile Pipeline

compile-view → compile-plan → compile-write → quality-review → quality-gate

| Command         | What it does                                                            |
| --------------- | ----------------------------------------------------------------------- |
| `compile-view`  | Output compile contract JSON (goal + evidence + hints)                  |
| `compile-plan`  | Dry-run: validate evidence completeness, preview compilation strategy   |
| `compile-write` | Generate child skill package + validate (same pipeline as compile-plan) |
| `quality-gate`  | Pass if quality-review score ≥ 90                                       |

---

## Output Invariants

| Invariant          | One-line rule                                                      |
| ------------------ | ------------------------------------------------------------------ |
| Business steps     | Merge raw gestures into semantic goal steps (seek, navigate, act)  |
| Bounded proof      | Every step must have postcondition + bounded retry                 |
| Semantic packaging | Keep scroll/sleep/click inside the parent step                     |
| Sleep barriers     | `base/sleep` between side-effecting action and verify              |
| Terminal verify    | Last step proves the user's goal was achieved                      |
| Flow vs handlers   | Business steps in `flow`, optional dialogs in `exception_handlers` |

---

## Common Compiler Decisions

| Recording pattern                | Compile as                            |
| -------------------------------- | ------------------------------------- |
| Multiple scrolls + tap on target | One `seek` step with retry loop       |
| Tap + page transition            | Navigation step with sleep + verify   |
| Optional dialog appears          | Move to `exception_handlers`          |
| Same-page state change (toggle)  | `act` step with property-delta verify |

---

## throw_if_empty Specification

Turns an empty-but-successful action result into a step failure, enabling retry loops and explicit proof.

### Scope

| Applies to                                                                   | Does NOT apply to                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `accessibility/node` (query-only — no `action` param)                        | `activity/launch_app`, `input/click`, `input/text`, `input/scroll_bezier`, `input/keyevent`, `base/sleep`, `system/shell` |
| `accessibility/node` (with `action` param) when used as a seek/reveal target | Any action path other than `accessibility/node`                                                                           |

Do NOT add `throw_if_empty` to non-`accessibility/node` actions. They do not return a `nodes` array — the field is silently ignored and verification does not work.

### Value

| Valid       | Invalid                          |
| ----------- | -------------------------------- |
| `["nodes"]` | `true`, `false`, `"nodes"`, `[]` |

The value MUST be an array of field names to check. Boolean values are silently ignored by the engine.

### Placement

`throw_if_empty` is an `ActionConfig` field — sibling to `path` and `params`, not inside `params`.

```json
{
  "path": "accessibility/node",
  "params": { "selector": { "text": "Settings" }, "wait_timeout": 5000 },
  "throw_if_empty": ["nodes"]
}
```

Putting it inside `params` sends it to the device API where it is silently ignored.

### When to use

| Scenario                                                                             | Use throw_if_empty?                                | Example                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------ |
| Verification action (query-only `accessibility/node`, no `action` param)             | **Yes** — this is the primary use                  | Arrival proof, terminal verify |
| Seek/reveal target (`accessibility/node` with `action: "click"` inside a retry loop) | **Yes** — makes "not found" retryable              | Scroll-then-click loop         |
| Business action (`accessibility/node` with `action: "click"`, single execution)      | Optional — step fails on its own if node not found | Button tap                     |
| Non-node action (`activity/launch_app`, `input/click`, etc.)                         | **No** — field is ignored                          | —                              |

### Seek/reveal pattern

Three parts, all required:

1. `completed: "success"` — step exits early on success
2. `loop.max_count` — bounded retry
3. `throw_if_empty: ["nodes"]` — makes "not found" a failure that triggers retry

Without all three, "find until success" behavior is brittle or wrong.

---

## Timing Baselines

### Constants

- `MIN_BARRIER_SLEEP_MS` = **1000** — minimum `base/sleep` duration after any async side-effecting action
- `MIN_VERIFY_WAIT_TIMEOUT_MS` = **5000** — minimum `wait_timeout` for verification node lookups

### The Three Timing Tools

- **`base/sleep`**: time barrier. Gives the UI time to settle after an async action. Not proof of anything.
- **`wait_timeout`**: condition wait. Polls for a selector to become available. Proves the selector appeared, but not necessarily that the business goal was met.
- **Verification** (`accessibility/node` + `throw_if_empty`): success gate. Proves a specific element exists on screen.

Standard pattern after a side-effecting action: `action → base/sleep → verify`. Don't substitute one tool for another. Do not let `wait_timeout` satisfy the sleep barrier requirement.

### Network-Dependent Operations

| Scenario                          | Recommended minimum                    |
| --------------------------------- | -------------------------------------- |
| Page load after navigation        | `wait_timeout` ≥ 8000ms                |
| Login/authentication              | `wait_timeout` ≥ 10000ms               |
| Search results loading            | `wait_timeout` ≥ 8000ms                |
| File download/upload              | `wait_timeout` ≥ 15000ms               |
| `base/sleep` after network action | ≥ 2000ms (vs 1000ms for local actions) |

---

## Shippability Validation

The following checks run automatically inside `compile-write`. Agent does not run them manually. Results are saved to `compile-report.json` for quality-reviewer.

| #   | Check                                                                                    | Maps to checklist | Auto-verified? |
| --- | ---------------------------------------------------------------------------------------- | ----------------- | -------------- |
| 1   | `throw_if_empty` at ActionConfig level (not inside params)                               | P0.2              | Yes            |
| 2   | No coordinate fields in verify_selector                                                  | P2.5              | Yes            |
| 3   | No obfuscated resource_id in shipped action selector                                     | P2.1              | Yes            |
| 4   | Action path exists in KNOWN_ACTION_PATHS                                                 | P0.1              | No             |
| 5   | Action path has no `api/` prefix                                                         | P0.1              | No             |
| 6   | Selector score > 10 for shipped selectors                                                | P2.1              | No             |
| 7   | Verify action has `throw_if_empty: ["nodes"]`                                            | P0.2              | No             |
| 8   | Verify action has `wait_timeout` >= 5000 ms                                              | P1.2              | No             |
| 9   | Loop interval >= 800 ms                                                                  | P1.6              | No             |
| 10  | Handler steps in exception_handlers, not in flow                                         | P1.7              | No             |
| 11  | Fixed-count loop has explicit `macro` intent                                             | —                 | No             |
| 12  | Observable postcondition for side-effecting intents (launch/navigate/seek/reveal/verify) | P1.3              | No             |
| 13  | Terminal step has verify action with throw_if_empty                                      | P0.5              | No             |

"Auto-verified" means compile-report.json marks these as pre-checked; quality-reviewer can skip re-verification. All other checks require AI judgment from the quality-reviewer.

---
