# Command Patterns

`vmos-edge-cli` has three invocation modes. All are CLI commands — they differ in syntax and when to use them.

## Three Modes

| | Direct | Batch | Run |
|---|--------|-------|-----|
| **CLI** | `vmos-edge-cli device list --host <ip>` | `vmos-edge-cli batch '<json>'` | `vmos-edge-cli run <file.yaml>` |
| **Action notation** | spaces: `device list` | dots: `device.list` | dots: `device.list` |
| **Params** | CLI flags: `--host <ip>` | JSON: `"args":{"host":"..."}` | YAML: `args: { host: "..." }` |
| **Param naming** | kebab-case: `--device-type` | snake_case: `device_type` | snake_case: `device_type` |
| **Variables** | — | `$name.path` | `${{ name.field }}` |
| **When** | Single action, or needs result inspection | Consecutive actions safe to run unconditionally | Reusable flow |

**The key rule:** If every step is safe to run regardless of previous steps' results → batch. If you need to inspect a result before deciding the next step → direct.

**Param name conversion:** CLI flags use `--kebab-case`; batch/YAML args use `snake_case`. Drop the `--` prefix and replace `-` with `_`: `--device-type` → `device_type`, `--adi-name` → `adi_name`, `-o`/`--output` → `output`. When unsure, run `vmos-edge-cli schema` — it lists every action with exact param names and types.

```bash
# ❌ 3 separate invocations
vmos-edge-cli device list --host 10.0.0.5
vmos-edge-cli image list --host 10.0.0.5
vmos-edge-cli host hardware 10.0.0.5

# ✅ 1 batch invocation
vmos-edge-cli batch '[
  {"action":"device.list","args":{"host":"10.0.0.5"}},
  {"action":"image.list","args":{"host":"10.0.0.5"}},
  {"action":"host.hardware","args":{"ip":"10.0.0.5"}}
]'
```

## Preflight

See [invocation-preflight.md](invocation-preflight.md) for the full install-and-verify flow.

Set `app.bin-path` before `app start`:

| Platform | Default path |
|----------|-------------|
| macOS | `/Applications/VMOS Edge 2.0.app` (auto-resolves to binary) |
| Windows | `C:\Program Files\VMOS Edge 2.0\VMOS Edge 2.0.exe` |
| Linux | `/opt/vmos-edge/vmos-edge` |

```bash
vmos-edge-cli config set app.bin-path "<path>"
```

Use `config show` to confirm. It returns merged `config` and raw `file` — a difference means a structural issue.

## Conventions

- All output uses a JSON envelope: `{"ok": true, "data": ...}` or `{"ok": false, "error": "...", "code": "..."}`.
- Explicit output paths for screenshots and reports.
- Use `schema` to see all actions and params. Only `sleep` is batch/run-only; all other actions have direct commands.

## Direct Commands

Use when **one** command completes the task. Action notation uses spaces.

### App, Device, Host, Image

```bash
vmos-edge-cli app status
vmos-edge-cli app start
vmos-edge-cli app stop
vmos-edge-cli app wait-ready [-t <ms>]
vmos-edge-cli device list --host <ip>
vmos-edge-cli device create --host <ip> --image <repo> --name <name> --count 3
vmos-edge-cli device create --host <ip> --image <repo> --name <name> --device-type real --adi-name <template> --start
vmos-edge-cli device info --host <ip> <id>
vmos-edge-cli device start --host <ip> <ids...>
vmos-edge-cli device stop --host <ip> <ids...>
vmos-edge-cli device restart --host <ip> <ids...>
vmos-edge-cli device reset --host <ip> <ids...>
vmos-edge-cli device delete --host <ip> <ids...>
vmos-edge-cli device rename --host <ip> <id> <name>
vmos-edge-cli device shell --host <ip> <id> "ls /sdcard"
vmos-edge-cli device screenshot --host <ip> <id> -o shot.png
vmos-edge-cli host check <ip>
vmos-edge-cli host info <ip>
vmos-edge-cli host hardware <ip>
vmos-edge-cli host network <ip>
vmos-edge-cli host templates <ip>
vmos-edge-cli host list --hosts <ip,ip,...>
vmos-edge-cli image list --host <ip>
```

### UI

See [ui-automation.md](ui-automation.md) for element selection and action details.

```bash
vmos-edge-cli ui state
vmos-edge-cli ui screenshot -o ui.png
vmos-edge-cli ui click <target>
vmos-edge-cli ui type <target> <text>
vmos-edge-cli ui select <target> <value>
vmos-edge-cli ui press-key <key>
vmos-edge-cli ui hover <target>
vmos-edge-cli ui goto <url>
vmos-edge-cli ui back
vmos-edge-cli ui scroll [direction]
vmos-edge-cli ui auto-scroll
vmos-edge-cli ui scroll-to <target>
vmos-edge-cli ui wait <target>
vmos-edge-cli ui wait-text <text>
vmos-edge-cli ui upload <files...> [-t <target>]
vmos-edge-cli ui dialog [action]
vmos-edge-cli ui windows
vmos-edge-cli ui form-state
vmos-edge-cli ui network
vmos-edge-cli ui eval <expression>
vmos-edge-cli ui native-type <text>
vmos-edge-cli ui native-key <key> [-m Ctrl,Alt,...]
vmos-edge-cli ui click-precise <target>
vmos-edge-cli ui cdp <method> [json-params]
```

## Batch

Batch is for **consecutive actions that are safe to run unconditionally** — each step must be safe to execute regardless of whether previous steps succeed or fail. If you need to inspect a result before deciding the next step, use direct commands instead.

```bash
vmos-edge-cli batch '[
  {"action":"device.list","args":{"host":"10.0.0.5"},"save":"devices"},
  {"action":"device.info","args":{"host":"10.0.0.5","id":"$devices[0].id"}}
]'
```

`save` stores step result; `$name.path` references it in later steps.

## Run (YAML Playbook)

Use when the flow should be stored, reviewed, replayed, or extended.

```bash
vmos-edge-cli run flow.yaml
vmos-edge-cli run flow.yaml --dry-run
vmos-edge-cli run flow.yaml --report html
```

YAML structure: `setup`, `steps`, `teardown`. Variable syntax: `${{ name.field }}` or `${{ steps[N].field }}`. **Not interchangeable with batch `$` syntax.**

```yaml
name: Open proxy page
setup:
  - action: app.wait-ready
    args: { timeout: 30000 }
steps:
  - action: device.list
    args: { host: "10.0.0.5" }
    save: devices
  - action: device.start
    args: { host: "10.0.0.5", id: ${{ devices[0].id }} }
```

Read `YAML.md` at the repository root for the full action catalog and report structure.

## Batch/Run-Only Actions

Only `sleep` has no direct command — it is only available via `batch` or `run`:

| Action | Params | Description |
|--------|--------|-------------|
| `sleep` | `seconds` (number) | Wait N seconds. Only for batch/YAML flows. |

## Artifacts

```bash
vmos-edge-cli ui screenshot -o ui.png
vmos-edge-cli device screenshot --host <ip> <id> -o device.png
vmos-edge-cli run flow.yaml --report html
```
