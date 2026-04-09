# Engine Runtime Contract

**Scope:** Engine schema reference. Load on demand during Phase 3 (compilation) or Phase 4 (delivery).

---

### `workflow/execute`

Asynchronous, single-instance. Expects a flat workflow payload:

```json
{
  "id": "wf_example",
  "name": "Example workflow",
  "description": "optional",
  "version": "1.0.0",
  "steps": {},
  "flow": [],
  "exception_handlers": [],
  "timeout": 30000
}
```

**Required:** `id: string`, `name: string` (non-blank), `steps: object` (non-empty), `flow: array` (non-empty)

**Optional:** `description: string | null`, `version: string` (default `"1.0.0"`), `exception_handlers: array`, `timeout: number`

Response wraps `WorkflowExecution` in standard envelope; `status` will be `PENDING` or `RUNNING` — poll `workflow/execution_get` for terminal status. If another workflow is already running, the endpoint throws an error.

---

### Status Values

`WorkflowExecution.status`: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED` | `CANCELLED` | `PAUSED`

---

### `ActionConfig`

- `path: string`
- `params?: Record<string, any>`
- `throw_if_empty?: string[]` — after the action returns, inspect the result map; for every listed key, throw if the value is `null`, empty string, empty list, empty map, or empty array

---

### `LoopConfig`

- `count?: number` — fixed loop count, do not check `completed`
- `max_count?: number` — retry-until-completed or fail
- `interval?: number`
- `count = -1`: infinite fixed loop
- `max_count = -1`: infinite retry loop

---

### `WorkflowStep`

- `id?: string`
- `description?: string`
- `actions: ActionConfig[]`
- `completed?: string`
- `loop?: LoopConfig`

---

### Critical Path Rule

Inside `workflow-script.json`, each `actions[].path` must omit the outer `api/` prefix.

Use: `input/click`, `input/text`, `accessibility/dump`
Do not use: `api/input/click`, `api/accessibility/dump`

The workflow executor adds `api/` internally before dispatch.

---

### Step Execution Rules

For each workflow step:

1. check exception handlers
2. determine loop strategy
3. wait `interval` ms if loop is configured (every iteration, including the first)
4. run actions in order
5. apply `throw_if_empty` validation
6. in `max_count` mode, evaluate `completed`
7. append a `StepRecord`

Important: no branching; no parallel step execution; exception handlers run between steps and before each step loop, not mid-action; if a `completed == "success"` step never succeeds within `max_count`, the workflow fails.

---

### Exception Handlers

Handlers run before each step and before each loop iteration. They match selectors against the current UI tree.

**`ExceptionHandler` Fields:**

- `selector?: Record<string, any>` — same NodeSelector format as `accessibility/node` (see [action-registry.md](action-registry.md))
- `action: string`, default `"click"` — one of the NodeAction values
- `name?: string`
- `action_params?: Record<string, any>`
- `max_trigger_count: number`, default `3`

**Valid `action` values** (case-insensitive): `click`, `long_click`, `set_text`, `clear_text`, `focus`, `clear_focus`, `select`, `clear_selection`, `copy`, `paste`, `cut`, `expand`, `collapse`, `dismiss`, `ime_enter`

```json
{
  "selector": { "text": "Allow" },
  "action": "click",
  "name": "dismiss_permission_dialog",
  "max_trigger_count": 5
}
```

---

### Query Endpoints

- **`workflow/execution_get`** — requires `execution_id`; returns the in-memory execution if running, otherwise loads from history storage.
- **`workflow/current_execution`** — returns current `WorkflowExecution` if one exists, otherwise `{ "running": false }`.

---

### Runtime Limitation

The engine does not support runtime variable interpolation. If the workflow needs dynamic data, render placeholders in `scripts/run.js` before sending the request.
