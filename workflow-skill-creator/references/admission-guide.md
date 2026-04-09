# Admission Guide

Phase 0 complete reference. Collect user intent, resolve all init parameters, validate before proceeding.
**Scope:** Phase 0 reference. Load when starting a new skill creation session.

## Why This Phase Exists

`init` needs 6 parameters (`--name`, `--task`, `--base-url`, `--app`, `--app-name`, `--start-page`). Asking the user for all of them creates friction and requires knowledge they often don't have (package names, skill naming conventions). The device already knows what apps are installed — let the agent query and resolve.

The user provides intent (what to automate) and connectivity (device IP). The agent resolves everything else by querying the device.

---

## Quick Reference

### Resolution Summary

| Field | Source | Command | Fallback |
|-------|--------|---------|----------|
| `--task` | User input | — | Ask user |
| `--base-url` | User input | — | Ask user |
| `--app` | Device query | `packages` | Ask user |
| `--app-name` | Device query | `packages` (same call) | Ask user |
| `--name` | Derived from task | — | Ask user |
| `--start-page` | Inferred | — | Default: home screen |
| `--login-state` | Inferred | — | Default: no login |

### Phase 0 → Phase 1 Handoff

```bash
# All values resolved in Phase 0, passed to init:
node $SKILL_DIR/scripts/skill_cli.js init \
  --dir $DIR \
  --name <derived-name> \
  --task "<user-task>" \
  --base-url $BASE_URL \
  --app <resolved-package> \
  --app-name "<resolved-app-name>"
```

---

## Contents

1. [Quick Reference](#quick-reference)
2. [Input Tiers](#input-tiers)
3. [Resolution Flow](#resolution-flow)
4. [Step 1 — Collect from User](#step-1--collect-from-user)
5. [Step 2 — Resolve App](#step-2--resolve-app)
6. [Step 3 — Derive Skill Name](#step-3--derive-skill-name)
7. [Step 4 — Infer Context](#step-4--infer-context)
8. [Step 5 — Confirm and Validate](#step-5--confirm-and-validate)
9. [Failure Modes](#failure-modes)

---

## Input Tiers

| Tier | Source | Fields | Why |
|------|--------|--------|-----|
| **1 — User provides** | Ask if missing | `--task`, `--base-url` | Only the user knows what they want to automate and where the device is |
| **2 — Agent resolves** | Query device + derive | `--app`, `--app-name`, `--name` | Device knows its own apps; name is mechanical derivation from task |
| **3 — Agent infers** | Default from task | `--start-page`, `--login-state` | Sensible defaults cover most cases |

**Override rule:** If the user explicitly provides any Tier 2/3 value, use it — skip resolution for that field.

---

## Resolution Flow

```text
User message
    ↓
[Step 1] Collect task + BASE_URL (ask if missing)
    ↓
[Step 2] Call `packages` → match app against task → get package_name + app_name
    ↓                                    ↓ (ambiguous)
    ↓                               Ask user to choose
    ↓
[Step 3] Derive skill name from task
    ↓
[Step 4] Infer start state + login state (defaults: home screen, no login)
    ↓
[Step 5] Show confirmation summary → run admission-check → GATE
    ↓
Phase 1: init with all resolved parameters
```

---

## Step 1 — Collect from User

Only two inputs are required from the user:

| Field | Format | If missing, ask |
|-------|--------|-----------------|
| Task description | Natural language | "Describe the operation to automate (e.g., open Settings → toggle Dark Mode)" |
| Device IP | `http://<ip>:18185/api` | "What is the Android device IP? (device must be running the workflow agent)" |

**Rejection criteria** — STOP and explain if task is:
- Infinite flow (no clear end state)
- No observable success signal
- Pure canvas/game app (no standard UI elements)
- Requires waiting for external events (push notifications, downloads, incoming messages)

---

## Step 2 — Resolve App

Query the device to find which app matches the user's task.

### 2.1 — List installed apps

```bash
node $SKILL_DIR/scripts/device_cli.js packages --base-url $BASE_URL
```

Returns `{ packages: [{ package_name, app_name, version_name, ... }] }`.

### 2.2 — Match against task

Read the `packages` list, find the app whose `app_name` best matches the task description.

| Scenario | Example | Resolution |
|----------|---------|------------|
| Clear match | Task: "send a message on WeChat" → `app_name: "WeChat"` | Use `package_name: com.tencent.mm`, `app_name: WeChat` |
| Clear match | Task: "toggle Dark Mode in Settings" → `app_name: "Settings"` | Use `package_name: com.android.settings`, `app_name: Settings` |
| Multiple candidates | Task: "send a message" → WeChat, QQ, Messages all match | Ask: "Multiple apps could handle this task: WeChat, QQ, Messages. Which one?" |
| No match | Task mentions app not installed | Ask: "Could not find a matching app. What is the app name or package?" |
| Task is system-level | Task: "take a screenshot" (no specific app) | May not need `--app`; proceed without or ask |

### 2.3 — Output

Two values for `init`:
- `--app <package_name>` (e.g., `com.android.settings`)
- `--app-name <app_name>` (e.g., `Settings`)

---

## Step 3 — Derive Skill Name

Convert task description to a valid skill name: lowercase, digits, hyphens only, under 64 characters.

| Task | Derived name |
|------|-------------|
| "Open Settings and toggle Dark Mode" | `toggle-dark-mode` |
| "Open About Phone page in Settings" | `open-about-phone` |
| "Send a message to John on WeChat" | `send-wechat-message` |

Focus on the **action + target**, drop the app name (it's in `--app`).

---

## Step 4 — Infer Context

| Field | Default | Override when |
|-------|---------|-------------|
| Start state | Home screen | Task explicitly says "start from cart page" or similar |
| Login state | No login required | App clearly requires auth (social, e-commerce, banking) |

When inferred, include assumptions in the Step 5 confirmation summary.

---

## Step 5 — Confirm and Validate

### 5.1 — Show confirmation summary

Present all resolved values to the user before proceeding:

```
Task: Open About Phone page in Settings
Device: http://192.168.1.100:18185/api
App: Settings (com.android.settings)
Skill name: open-about-phone
Start state: home screen (inferred)
Login: not required (inferred)
```

Wait for user confirmation. They may correct any value.

### 5.2 — Run admission-check

```bash
node $SKILL_DIR/scripts/skill_cli.js admission-check --base-url $BASE_URL --task "<task>"
```

### 5.3 — Gate checklist

All must pass before Phase 1:

- [ ] BASE_URL set and device reachable
- [ ] Task is concrete with observable success signal
- [ ] App package resolved (via `packages` or user override)
- [ ] App display name resolved
- [ ] Skill name derived (or user override)
- [ ] Start state defined
- [ ] Login state defined

**HARD STOP: Do NOT proceed to Phase 1 until every item above is checked.**

---

## Failure Modes

| Scenario | Symptom | Recovery |
|----------|---------|----------|
| Device offline | `packages` or `admission-check` fails with connection error | Verify device IP, check if workflow agent is running |
| No matching app | `packages` returns list but no app matches task | Ask user for app name; try `--type all` to include system apps |
| Task too vague | No clear success signal identifiable | Ask: "How would you know the task is done? What should be visible on screen?" |
| App requires login | Task involves auth-gated features | Ask for credentials; inform user they are recorded as plaintext |

