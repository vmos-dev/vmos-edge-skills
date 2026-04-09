# Action Registry

**Scope:** API action parameter reference. Load on demand during Phase 2 (recording) or Phase 3 (compilation).

All actions are called via the workflow engine, which prepends `api/` internally. In `workflow-script.json`, always omit the `api/` prefix.

### API Response Format

All SDK HTTP endpoints wrap their response in a standard envelope:

```json
{
  "request_id": "uuid",
  "code": 200,
  "msg": "OK",
  "data": { },
  "cost": 123
}
```

- `code: 200` = success; other values = error
- The actual result is always inside the `data` field

When writing `scripts/run.js`, use `normalizeResponse` to unwrap it.

---

## Core Actions

### `accessibility/node`

Find UI nodes by selector and optionally perform an action. **Primary way to interact with UI elements.**

```json
{ "path": "accessibility/node", "params": { "selector": { "text": "Settings" }, "action": "click" } }
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| selector | object | yes | — | Node selector criteria (see below) |
| wait_timeout | long | no | 0 | Wait for node to appear, 0=no wait |
| wait_interval | long | no | 500 | Check interval when waiting |
| action | string | no | — | Action to perform on found node |
| action_params | object | no | — | Action params, e.g. `{"text":"..."}` for set_text |
| action_index | int | no | 0 | Which matching node to act on |

#### NodeSelector Criteria

| Field | Type | Description |
|-------|------|-------------|
| text | string | Visible text (supports regex) |
| content_desc | string | Content description (supports regex) |
| resource_id | string | Resource ID (e.g. `com.app:id/button`) |
| class_name | string | Widget class (e.g. `android.widget.Button`) |
| xpath | string | XPath expression |
| index | int | Child index |
| clickable | boolean | Is clickable |
| enabled | boolean | Is enabled |
| scrollable | boolean | Is scrollable |
| checkable | boolean | Is checkable |
| checked | boolean | Is checked |
| center_x | int | Center X coordinate |
| center_y | int | Center Y coordinate |

Tooling note: this repo accepts `class_name` and canonicalizes to runtime `class`.

#### NodeAction Values

Used in `action` param and in `ExceptionHandler.action`:

`click`, `long_click`, `set_text`, `clear_text`, `focus`, `clear_focus`, `select`, `clear_selection`, `copy`, `paste`, `cut`, `expand`, `collapse`, `dismiss`, `ime_enter`

Response data: `{ "count": 1, "nodes": [...], "action": "click", "action_index": 0, "action_success": true }`

---

### `activity/launch_app`

Launch an application by package name. **Always use this instead of clicking app icons.**

```json
{ "path": "activity/launch_app", "params": { "package_name": "com.android.settings" } }
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| package_name | string | yes | — | Package name to launch |
| grant_all_permissions | boolean | no | false | Auto-grant all permissions |

---

### `input/scroll_bezier`

Primary scroll gesture for directional movement.

```json
{ "path": "input/scroll_bezier", "params": { "start_x": 540, "start_y": 1500, "end_x": 540, "end_y": 500, "duration": 500 } }
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| start_x | int | yes | — | Start X |
| start_y | int | yes | — | Start Y |
| end_x | int | yes | — | End X |
| end_y | int | yes | — | End Y |
| duration | int | no | 500 | Duration in ms |

Scroll down = start_y > end_y. All params are snake_case.

---

### `input/keyevent`

Send key press.

```json
{ "path": "input/keyevent", "params": { "key_code": 4 } }
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| key_code | int | yes* | Single key code: HOME=3, BACK=4, ENTER=66 |
| key_codes | int[] | yes* | Multiple key codes for combo |

*One of `key_code` or `key_codes` is required.

---

### `input/text`

Type text into the currently focused field.

```json
{ "path": "input/text", "params": { "text": "hello world" } }
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| text | string | yes | Text to input |

---

### `input/click`

Tap a screen coordinate. **Last resort** — prefer `accessibility/node` for selector-based interaction.

```json
{ "path": "input/click", "params": { "x": 540, "y": 1200 } }
```

Must pair with `--verify-selector` during recording, otherwise walk rejects.

---

### `base/sleep`

Time barrier between side-effecting actions. Not proof of success.

```json
{ "path": "base/sleep", "params": { "duration": 2000 } }
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| duration | long | yes | Duration in milliseconds |

---

### `system/shell`

Execute a shell command on the device.

```json
{ "path": "system/shell", "params": { "command": "am start -a android.settings.WIFI_SETTINGS", "is_root": true } }
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| command | string | yes | — | Shell command |
| is_root | boolean | no | true | Run with root |

---

### `package/list`

Query installed applications. Used in Phase 0 to discover `package_name`.

```json
{ "path": "package/list", "params": { "type": "user" } }
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| type | string | no | "user" | "all", "system", or "user" |

Returns `{ type, count, packages[] }` where each package has `package_name`, `app_name`, `version_name`, etc.

---

### Workflow API Paths

Called from `scripts/run.js` via HTTP, not inside `workflow-script.json` steps:

| Path | Method | Description |
|------|--------|-------------|
| `workflow/execute` | POST | Submit workflow for async execution |
| `workflow/run_step` | POST | Execute a single step synchronously |
| `workflow/execution_get` | POST | Query execution by `execution_id` |
| `workflow/current_execution` | POST | Get current execution status |
| `workflow/cancel` | POST | Cancel running workflow |

---

For the complete action list including contact, sms, sensor, battery, location, etc., query the device via `/base/list_action` or run `device_cli.js act --help`.
