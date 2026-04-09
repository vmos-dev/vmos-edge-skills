---
name: {{skill_name}}
description: {{description}}
metadata:
  display_name: {{display_name}}
  version: 1
  observe_mode: auto
  app_name: {{app_name}}
  package_name: {{target_package}}
  scenarios:
{{scenarios_section}}
---

# {{display_name}}

## Outcome

{{outcome_section}}

## Trigger Phrases

{{trigger_phrases_section}}

## Runtime Contract

- This child skill accepts no business parameters.
- Requires `CONTROL_API_URL` environment variable.
- Run: `node scripts/run.js`

## Failure Modes

{{failure_modes_section}}
