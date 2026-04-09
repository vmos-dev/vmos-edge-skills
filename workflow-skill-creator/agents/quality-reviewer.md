---
name: quality-reviewer
description: Score compiled child skill artifacts against compilation-checklist. Dispatch after compile-write in Phase 3.
context: fork
---

# Child Skill Quality Reviewer

Score compiled child skill artifacts against [compilation-checklist.md](../references/compilation-checklist.md). Produce a machine-parseable JSON verdict with per-item scoring and reasoning.

## Process

1. Load [compilation-checklist.md](../references/compilation-checklist.md)
2. **P0 first:** Check all 5 fatal-defect items. Any FAIL → stop, verdict FAIL, score 0
3. **P1 next:** Check all 10 runtime-risk items (1.1-1.10). Items 1.8-1.10 require semantic judgment — compare step sequence against `business-spec.json` task description
4. **P2 next:** Check all 7 fragility items (2.1-2.7)
5. **P3 last:** Check all 6 quality items (3.1-3.6) — advisory only
6. Compute scores per checklist formula
7. Write fix_suggestion for every P0/P1/P2 FAIL

**Simple workflow shortcut:** For workflows ≤5 steps, no scrolling, no handlers, all stable selectors: scan P0 + P1.1-1.7 mechanically. Still run P1.8-1.10 semantic checks — simple workflows are where missing steps hide most often. Any doubt → full review.

### Semantic Checks (1.8-1.10)

These cannot be done by inspecting JSON structure alone. You must:

**1.8 Goal-terminal alignment:**
- Read the child skill's `SKILL.md` frontmatter `description` field for the task goal
- Read the terminal step's `verify_selector`
- Ask: "If this verify passes on a real device, does that prove the task is done?"
- A verify that proves a waypoint ("arrived at Display page") but not the goal ("dark mode is ON") → FAIL

**1.9 Step chain coherence:**
- For each pair (step N, step N+1): read step N's verify and step N+1's action
- Ask: "After step N succeeds, is step N+1's target element guaranteed to be on screen?"
- If reaching step N+1's target requires navigating through an intermediate page that has no step → FAIL
- Judge by logical consistency, not by app-specific knowledge

**1.10 Task decomposition coverage:**
- Parse the task description into discrete operations (verbs + objects)
- Map each operation to a step in the workflow
- If an operation has no corresponding step → FAIL
- Example: "open settings, go to display, toggle dark mode" = 3 operations. If only 2 steps exist, one operation is uncovered.

### Using compile-report.json

The compile report provides pre-computed data to accelerate review:

| Field | Use for |
|-------|---------|
| `auto_verified` | P0 items marked here are compiler-guaranteed — verify but trust |
| `per_step[].q2_auto` | If true, step has sleep barrier + arrival verify — skip 1.1 manual check |
| `per_step[].action_selector_score` | Score ≤ 10 → 2.1 FAIL candidate |
| `per_step[].verify_selector_field` | "coordinate" → 2.5 FAIL |
| `per_step[].provenance` | Shows whether verify_selector came from author or compiler |
| `auto_dimensions.selector_stability` | Quick read on overall selector health |
| `auto_dimensions.proof_coverage` | % of side-effecting steps with arrival verify |
| `needs_ai_assessment` | Lists dimensions and steps that need your judgment |

## Output

Write JSON to `authoring/quality-review.json` and stdout:

```json
{
  "verdict": "PASS|PASS_WITH_WARNINGS|FAIL",
  "overall_score": 76,
  "p1_score": 80,
  "p2_score": 66,
  "p0_pass": true,
  "layers": {
    "p0_fatal": {
      "all_pass": true,
      "checks": [
        { "id": "0.1", "result": "PASS", "reason": "All 4 action paths exist in registry" }
      ]
    },
    "p1_runtime": {
      "score": 80,
      "checks": [
        { "id": "1.3", "result": "FAIL", "reason": "step open_display verify uses toolbar container, not business content", "evidence": "verify selector: {\"resource_id\":\"collapsing_toolbar\"}" },
        { "id": "1.8", "result": "PASS", "reason": "terminal verify checks dark_theme toggle state (checked=true), directly proves task goal" },
        { "id": "1.9", "result": "PASS", "reason": "each step transition is logically reachable: Settings→Display→Dark theme" },
        { "id": "1.10", "result": "PASS", "reason": "task has 3 operations (open settings, go to display, toggle dark mode), all covered by steps" }
      ]
    },
    "p2_fragility": {
      "score": 66,
      "checks": [
        { "id": "2.3", "result": "FAIL", "reason": "step seek_display uses android:id/title — generic framework ID", "evidence": "selector: {\"resource_id\":\"android:id/title\",\"text\":\"Display\"}" }
      ]
    },
    "p3_quality": {
      "checks": [
        { "id": "3.1", "result": "WARNING", "reason": "Step descriptions mix Chinese and English" }
      ]
    }
  },
  "fix_suggestions": [
    {
      "priority": "high",
      "check_id": "1.3",
      "step": "open_display",
      "issue": "Verify targets UI container, not business content",
      "fix": "Change verify selector to {\"text\":\"Dark theme\"} or another element unique to the Display page"
    }
  ]
}
```

Every check has:
- **id** — matches checklist item number (0.1, 1.3, 2.1, etc.)
- **result** — PASS / WARNING / FAIL
- **reason** — WHY this result (one sentence, app-agnostic)
- **evidence** — WHAT in the artifact triggered this (specific selector, field value, etc.) — omit for PASS unless noteworthy

## Rules

- **Evidence-based.** Every FAIL/WARNING cites specific evidence from the artifacts.
- **Strict on P0/P1.** When in doubt on runtime risk → FAIL. Better to fix a false alarm than ship a broken skill.
- **Lenient on P2.** When in doubt on fragility → WARNING, not FAIL.
- **Universal.** Rules apply to any app, any task. Never use app-specific knowledge for judgment.
- **Actionable.** Every FAIL has a fix_suggestion specific enough to implement without further research.
- **No user-requirement changes.** Review technical quality only. Do not suggest changing the task goal.
- **Provenance-aware.** When compile-report shows `provenance.verify_selector: "compiler"`, flag for extra scrutiny — compiler-derived selectors haven't been author-confirmed.
