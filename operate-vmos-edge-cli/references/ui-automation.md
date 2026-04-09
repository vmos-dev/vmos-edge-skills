# UI Automation

## Cost Guide

| Cost | Actions | When to use |
|------|---------|-------------|
| **Free & instant** | `state`, `form-state`, `network`, `windows`, `eval`, `scroll`, `scroll-to`, `hover` | Default — use these for inspection |
| **Free, changes page** | `click`, `type`, `select`, `press-key`, `goto`, `back`, `native-type`, `native-key` | Interaction — run `state` after |
| **Expensive (vision)** | `screenshot` | ONLY when user explicitly needs a saved image |

## Workflow

```
ui state → read output → pick index → action → ui state → next
```

1. **Run `ui state`** to get the element tree. Each interactive element is marked `[N]` (starting from 1). On complex pages with too many elements, filter non-interactive elements:
   - CLI: `vmos-edge-cli ui state --interactive-only`
   - batch: `{"action":"ui.state","args":{"interactiveOnly":true}}`
   - YAML: `action: ui.state` / `args: { interactive_only: true }`
2. **Read the output.** New or changed elements since the last snapshot are marked with `*` prefix — focus on those first. The footer shows `interactiveCount` and a `hidden_interactive` section listing off-screen elements with distance and direction.
3. **Pick the numeric index** of the target element.
4. **Execute the action** with that index.
5. **Run `ui state` again** after any page-changing action — indices are only valid for the current DOM snapshot.

## Selecting Elements

Use numeric index by default. Pass it as a number or string in any context:

| Context | Example |
|---------|---------|
| CLI | `ui click 3` |
| YAML | `target: 3` |
| batch JSON | `"target": 3` |

### If the target element is missing

- **Behind a modal/overlay** — the snapshot automatically hides elements occluded by opaque overlays. Dismiss the modal first, then re-run `ui state`.
- **Off-screen** — check the `hidden_interactive` footer section. It shows the element tag, text, direction (above/below), and distance in pages. Use `ui scroll-to <N>` to bring it into view.
- **Too many elements to scan** — use `interactiveOnly` to filter (see Workflow step 1 above for all three syntax forms)

### Fallback Selectors

When the index is impractical (too many elements, or a playbook that must survive UI changes), use a semantic selector string:

| Selector | Example |
|----------|---------|
| `text=` | `"text=Save"` — visible text (exact then partial) |
| `placeholder=` | `"placeholder=Enter email"` |
| `role=` | `"role=button"` or `"role=button text=OK"` |
| `testid=` | `"testid=submit-btn"` — matches `data-testid` / `data-test` / `data-test-id` |
| `label=` | `"label=Username"` — `<label>` text or `aria-label` |
| CSS | `"button.primary"` — standard CSS selector |
| `data-ref` | `"my-ref"` — matches `data-ref` attribute |

Resolution order follows the table top-to-bottom: index first, then text, placeholder, role, testid, label, CSS, data-ref.

## Actions

### Actions that accept `target`

| Action | Params | Notes |
|--------|--------|-------|
| `ui click` | target | |
| `ui click-precise` | target | CDP getContentQuads. |
| `ui type` | target, text | |
| `ui select` | target, value | |
| `ui hover` | target | |
| `ui scroll-to` | target | |
| `ui wait` | target | |
| `ui upload` | files, target (optional) | |

### Actions without `target`

| Action | Params | Notes |
|--------|--------|-------|
| `ui native-type` | text | CJK/IME safe. **Click to focus first.** |
| `ui native-key` | key, modifiers[] | **Click to focus first.** |
| `ui press-key` | key | |
| `ui wait-text` | text | |
| `ui goto` | url | |
| `ui back` | — | |
| `ui scroll` | direction | |
| `ui auto-scroll` | — | |
| `ui dialog` | action | |
| `ui eval` | expression | |
| `ui cdp` | method, params | Raw CDP passthrough. |

### Inspect (read-only)

| Action | Returns |
|--------|---------|
| `ui state` | `url`, `title`, `snapshot` (text tree with `[N]`), `interactiveCount` |
| `ui screenshot` | image file (use `-o` to set path) |
| `ui form-state` | form fields and values |
| `ui network` | captured network requests |
| `ui windows` | list of Electron windows |

## `eval` Rules

`ui eval` is **read-only** — use it only for data extraction, never for clicking, typing, or navigating.

```bash
# ✅ Read data
vmos-edge-cli ui eval "JSON.stringify([...document.querySelectorAll('h2')].map(e => e.textContent))"

# ✅ Wrap in IIFE to avoid variable conflicts
vmos-edge-cli ui eval "(function(){ const items = ...; return JSON.stringify(items); })()"

# ❌ Never click/type via eval
vmos-edge-cli ui eval "document.querySelector('button').click()"  # Use ui click instead
```

## Examples

CJK input (click to focus, then native-type):

```yaml
- action: ui.click
  args: { target: 3 }
- action: ui.native-type
  args: { text: "你好世界" }
```

Key combo Ctrl+A (click to focus, then native-key):

```yaml
- action: ui.click
  args: { target: 3 }
- action: ui.native-key
  args: { key: "a", modifiers: ["Ctrl"] }
```

Raw CDP call:

```yaml
- action: ui.cdp
  args: { method: "Page.reload", params: { ignoreCache: true } }
```

## Timing

- Do not add hard waits after normal UI actions — the runner already waits for the page to settle.
- Use `sleep` only for genuinely slow external state changes (device provisioning, boot).
- `ui scroll-to` before interacting with off-screen elements.
