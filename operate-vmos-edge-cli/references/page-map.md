# Page Map — VMOS Edge Desktop

`ui state` only shows currently visible elements. This file documents hidden features and how to reveal them.

**i18n note:** The app supports zh-CN, en-US, and zh-TW. Button labels change with language. Key triggers below show both Chinese and English labels as `"中文" / "English"`. Use `ui state` to match the actual label.

To reveal hover-triggered buttons, use `ui hover <index>` then `ui state` to see newly visible elements.

## Navigation

| Page             | Route         | Tab / Access                                             |
| ---------------- | ------------- | -------------------------------------------------------- |
| Cloud Phone      | `/cloud`      | "云机" / "Cloud Phone"                                   |
| Host             | `/host`       | "主机" / "Host"                                          |
| Image            | `/image`      | "镜像" / "Image"                                         |
| Proxy            | `/proxy`      | "代理" / "Proxy"                                         |
| Automation       | `/automation` | "AI 工作流" / "AI Workflow"                              |
| AI Agent         | `/ai-agent`   | "AI Agent"                                               |
| General Settings | `/general`    | Header → settings icon → "通用设置" / "General Settings" |
| Machine Settings | `/adi`        | Header → settings icon → "机型设置" / "ADI Settings"     |
| Phone Control    | `/phone`      | Separate window — cast a device from Cloud Phone page    |

## Task → Page

| Task                                                               | Go to                     |
| ------------------------------------------------------------------ | ------------------------- |
| Create / start / stop / delete device                              | Cloud Phone               |
| Batch install APK, run script, set proxy                           | Cloud Phone → batch panel |
| Clone, modify image, rename device                                 | Cloud Phone → device menu |
| Add / remove / restart host                                        | Host                      |
| Upgrade host kernel or CBS                                         | Host → batch dropdown     |
| Import backup to host                                              | Host → row action button  |
| Download / import / delete images                                  | Image                     |
| Add / import / edit proxy configs                                  | Proxy                     |
| Generate workflow via AI chat, run script                          | Automation                |
| Chat with AI agent to control device                               | AI Agent                  |
| Change theme, window size, capture settings                        | General Settings          |
| Change app language                                                | Header → language selector (top-right, near settings icon) |
| View / import device machine models                                | Machine Settings          |
| Control device screen, install APK, file transfer, simulate sensor | Phone Control             |

## Cloud Phone (`/cloud`)

Layout: left sidebar (device tree) + right main area (device list/grid).

### Hidden: Device Context Menu

Click the `⋯` icon on a device tree node to open a dropdown menu.

| Device state | Menu items shown                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Running      | restart, shutdown, details, rename, API, modify image, set proxy, close proxy, timezone/language, renew, reset, clone, delete |
| Stopped      | start, rename, API, modify image, clone, delete                                                                               |
| Failed       | start only                                                                                                                    |
| Offline      | no menu                                                                                                                       |

### Hidden: Batch Operations Panel

Click "批量操作" / "Batch Operation" button in toolbar → panel expands below toolbar.

Actions: start, restart, shutdown, backup, renew, reset, delete, set proxy, close proxy, execute command, batch execute script, close script, batch install, batch upload, modify location, modify system properties, copy info, cast, sort, close window.

**Must select devices first** — check devices in tree or table before using batch actions.

### Hidden: Create Cloud Phone Drawer

Click `+` icon on an **online** host node in sidebar tree → opens creation form drawer.

Drawer has four sections with toggle-controlled hidden fields (use `ui state` to explore):

1. **Basic** — image, device type (real/virtual), resolution, FPS, GMS
2. **Network** — DNS, proxy, region/timezone/language, LAN IP (macvlan)
3. **Advanced** — custom system properties, custom certificate
4. **Submit** — device name, count, auto-start

### Hidden: Tree Node Action Buttons

Hover over the tree node's label text (not the expand arrow) to reveal icon buttons. **Only online hosts show action buttons; offline hosts have none.**

- **Group node**: add member, edit name, delete group
- **Host node** (online only): restart host, create device

### Hidden: Sidebar Button Dialogs

| Button                   | Opens                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| "添加分组" / "Add Group" | Dialog to enter group name                                                            |
| "添加主机" / "Add Host"  | Dialog with two tabs: scan discover (radar auto-search LAN hosts) and manual IP input |

### Hidden: Device Menu & Batch Panel Dialogs

| Action                   | Trigger                            | Opens                                                                                        |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Device details           | device menu                        | Device ID, name, image, version, type, brand/model, resolution, host IP, ADB address, LAN IP |
| Rename                   | device menu                        | Input new device name                                                                        |
| Modify image             | device menu                        | Select new image                                                                             |
| Set proxy                | device menu (single) / batch panel | Select existing or custom proxy, with connectivity test                                      |
| Timezone/language        | device menu                        | Select region, timezone, language                                                            |
| Clone                    | device menu                        | Set clone name prefix and count                                                              |
| Renew                    | device menu / batch panel          | Select new image and machine config to recreate                                              |
| Backup                   | batch panel                        | Shows per-device backup progress (download to local)                                         |
| Execute command          | batch panel                        | Input shell command, with command template shortcuts                                         |
| Batch execute script     | batch panel                        | Select script from library to run                                                            |
| Close script             | batch panel                        | Confirm closing running scripts                                                              |
| Batch install            | batch panel                        | Drag-and-drop APK files to upload                                                            |
| Batch upload             | batch panel                        | Drag-and-drop any files to upload                                                            |
| Modify location          | batch panel                        | Input coordinates, altitude, speed, bearing; includes map picker. **GPS can only be set after device creation, not during.** |
| Modify system properties | batch panel                        | Select preset properties or input custom JSON                                                |
| Copy info                | batch panel                        | Select fields and separator, preview then copy                                               |

## Host (`/host`)

### Hidden: Batch Operation Dropdown

Click "批量操作" / "Batch Operation" button → dropdown: upgrade kernel, upgrade CBS, restart, reset host, clean image, batch import image, join share, close share, batch delete.

**Must select hosts first** — check hosts in the table before using batch actions.

### Hidden: Row Action Dialogs

Each row has action buttons (disabled when host offline):

| Button                                | Opens                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "详情" / "Detail"                     | Host info dialog: ID, IP, model, share status, resource usage (CPU, CPU temp, memory, storage with progress bars) |
| "导入备份" / "Import Backup"          | Select .tar file to upload, shows upload progress                                                                 |

### Hidden: Batch Dropdown Dialogs

| Action                   | Opens                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Upgrade kernel / CBS     | Firmware upload dialog with drag-and-drop, shows per-host progress |
| Batch import image       | Upload .tar.zst image file dialog with decompression progress      |
| Join share / Close share | Shows share result dialog after execution                          |

## Image (`/image`)

If storage path is invalid, clicking the import image button prompts to set path first instead of opening the import dialog.

## Proxy (`/proxy`)

### Hidden: Add/Edit Proxy Dialog

Click add proxy button or row edit button → dialog supporting protocols: HTTP, HTTPS, SOCKS5, SS, SSR, VMess, VLESS.

### Hidden: Import Proxy Dialog

Click import proxy button → opens bulk import dialog.

## Automation (`/automation`)

Three-column layout: AI chat (left) | script preview (center) | device screen (right).

### Hidden: Model Management

Click the link at bottom of model selector dropdown, or the settings button next to it → opens model manager dialog.

### Hidden: Step Parameter Editors

Each step in script preview has an expand/edit button → click to reveal editable parameter fields.

### Hidden: Script Library

Click script library button at top of script preview column → opens saved script library dialog.

### Hidden: Device Selector

Click device name area in right column header → opens device selector dialog.

## AI Agent (`/ai-agent`)

Three-column layout: conversation list (left) | chat (center) | device screen (right).

### Hidden: Batch Delete Mode

Click multi-select button at bottom of left panel → enters multi-select mode with checkboxes. Select conversations then click delete. Click cancel to exit.

### Hidden: Model Configuration

- If no model configured: a warning-style configure model button appears in header → click to open settings.
- If model configured: button showing model name → click to open settings.
- Skills button in header → opens skill manager dialog.

## General Settings (`/general`)

### Hidden: Capture Device Selectors

Camera selector only appears when capture type includes video. Microphone selector only appears when capture type includes audio. RTSP address only appears after capture is enabled.

## Machine Settings (`/adi`)

Two tabs: general models and custom models.

### Hidden: Custom Model Actions

Switch to custom models tab to reveal: collection tool button, import settings button (opens import dialog), and delete action column in table. Not visible on general models tab.

## Phone Control (`/phone`)

### Hidden: Conditional Toolbar Buttons

- **Group Room** — only appears if device is the master in group control mode.
- **Simulator** — opens simulation panel, but **only works if device API version ≥ 10400**. Otherwise shows error.

### Hidden: Side Panels

Clicking a toolbar button toggles a side panel on the right:

| Button     | Panel content                                                                      |
| ---------- | ---------------------------------------------------------------------------------- |
| App        | Upload and install APK/XAPK files                                                  |
| File       | Upload files to device / download files to local                                   |
| Group Room | Online device count + join/leave activity log                                      |
| Simulator  | Tabs: Multimedia, SMS & Call (Contact, SMS Records, Call Records), Sensor, Battery |

### Hidden: Device State Overlay

When device is loading, offline, or stopped, screen shows a status overlay. If stopped, a power-on button appears on the overlay.
