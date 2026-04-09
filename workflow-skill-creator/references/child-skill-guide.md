# Child Skill Guide

**Scope:** Phase 4 reference. Load when generating child skill delivery package.

## Child Skill Package Structure

```text
child-skill/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── assets/
│   ├── business-spec.json
│   └── workflow-script.json
└── scripts/
    └── run.js
```

The shipped package is runtime-only. Optional `evals/` may exist but are not part of the shipped package.

### Blind runtime contract

A shipped child skill runs as a blind workflow package — it cannot observe the device, cannot invent new strategies at runtime, and can only execute the compiled workflow with its encoded retry logic. Therefore the compiled workflow must satisfy the output invariants and shippability checks defined in SKILL.md § Phase 3.

### File responsibilities

**`SKILL.md`** — AI-to-AI invocation interface. Frontmatter structure:

Standard fields (top-level):
- `name`: lowercase letters, digits, hyphens only
- `description`: short intent-based description (see Description Standards below)

Extension fields (under `metadata:`):
- `display_name`: human-readable name
- `version`: integer (start at 1)
- `observe_mode`: `auto` | `dump` | `vision`
- `app_name` / `package_name`: target app identifiers
- `scenarios`: list of user-facing trigger phrases

Body sections: `## Outcome`, `## Trigger Phrases`, `## Runtime Contract`, `## Failure Modes`. Keep prose runtime-focused — no authoring history or compile commands.

**`business-spec.json`** — Runtime config: `name` (matches frontmatter), `runtime.pollIntervalMs`, `runtime.timeoutMs`.

**`workflow-script.json`** — Fully static JSON workflow payload. No `{{paramName}}` placeholders. Top-level shape: `steps`, `flow`, `exception_handlers`, `timeout`.

**`scripts/run.js`** — Thin runtime adapter: load specs, read `CONTROL_API_URL` env, POST to `workflow/execute`, poll `workflow/execution_get` until terminal, return normalized JSON.

## SKILL.md Description Standards

The `description` frontmatter field is the primary triggering mechanism.

- **Intent-based**: describe what the user wants, not what the workflow does internally. "Use when the user wants to force-stop an app" > "Use when running a workflow that calls activity/force_stop".
- **Pushy on edge cases**: include alternative phrasings real users would say. Users say "kill the app", not "execute the force-stop workflow".
- **Differentiated**: when multiple skills target the same app, descriptions must distinguish them clearly.

GOOD: "Use when the user needs to log in to WeChat automatically on Android. Executes a pre-recorded login workflow via device base_url."

BAD:
- "WeChat login automation skill" (no "Use when")
- "Automates login by tapping..." (describes workflow, not trigger)
- Too narrow (only one exact phrasing) or too broad (triggers on unrelated requests)

## Quality Standards

### Core Rules

1. **Child-facing only.** No parent-authoring language (`compile-view`, `walk`, `authoring/`), no raw action paths (`activity/launch_app`), no transcript phrases (`step_1`). The child reader is a runtime consumer.
2. **Intent-based.** Describe user outcomes and business goals, not mechanical step sequences.
3. **Workflow shape frozen.** The workflow-script.json shape must stay unchanged — improve prose quality without inventing new runtime fields.
4. **Terminal proof in prose.** "Success is proven when ..." must match the actual terminal verify in workflow-script.json.
5. **Runtime failure posture.** Describe regeneration as refreshing from stronger device evidence, never "return to the parent skill".

### Child SKILL.md Quality Bar

- `Outcome`: what the child accomplishes + "Success is proven when ..." claim.
- `Trigger Phrases`: user-facing request language that should activate the child.
- `Runtime Contract`: static workflow, no business params, `CONTROL_API_URL` env required.
- `Failure Modes`: runtime proof posture and interruption behavior.

### Common Pitfalls

1. Treating a weak selector as user-visible success — the user cares about the business outcome, not which DOM node was found.
2. Adding scenario-specific prose hacks when a generic quality rule would work — hacks accumulate and become inconsistent.
