# Error Recovery

## Parse The JSON Envelope First

Expect this success shape:

```json
{"ok": true, "data": ...}
```

Expect this failure shape:

```json
{"ok": false, "error": "...", "code": "HOST_UNREACHABLE"}
```

Branch on `code` first, then use `error` as supporting detail.

## Recover Deterministically

- `HOST_NOT_SET`
  - Pass `--host <ip>`.
- `INVALID_ARGS`
  - Fix the command shape or parameter set. Do not retry blindly.
- `DEVICE_NOT_FOUND`
  - Run `device list` and retry with a current id.
- `IMAGE_NOT_FOUND`
  - Run `image list` and retry with a current image id.
- `ELEMENT_NOT_FOUND`
  - Run `ui state` again and use a fresh target.
- `APP_NOT_RUNNING`
  - Run `app start`.
- `HOST_UNREACHABLE`
  - Check IP and network reachability.
- `CDP_NOT_READY`
  - Wait briefly after startup and retry. If the app was not started yet, run `app start` first.
- `TIMEOUT`
  - Retry when the operation should eventually complete.
- `TRANSIENT`
  - Retry the same action once, then re-inspect state if it still fails.
- `CONFIG_MISSING`
  - Run `config show` and compare `config` vs `file` — if they differ, the YAML file has a structural issue. Fix with `config set`.
- `OPERATION_FAILED`
  - Report the real error and avoid blind retries.
- `ASSERTION_FAILED`
  - Treat the asserted postcondition as false. Re-inspect state and report the mismatch.
- `UNKNOWN`
  - Report the raw error and inspect the last command, prerequisites, and current state.

## Retry Only When It Makes Sense

Retry only for:

- startup readiness
- transient transport failures
- timeouts on operations that are expected to finish eventually

Do not retry without changing anything for:

- `INVALID_ARGS`
- `HOST_NOT_SET`
- `DEVICE_NOT_FOUND`
- `IMAGE_NOT_FOUND`
- `ELEMENT_NOT_FOUND`
- `ASSERTION_FAILED`

## Report Failures Clearly

When a command fails, report:

- the command you ran
- the returned `code`
- the key error text
- the next corrective step
