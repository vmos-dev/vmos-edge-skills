const {
  normalizeRuntimePayload,
  normalizeSelectorForRuntime,
  postJson,
  sleep,
} = require('./utils');

/**
 * POST to a device action path and return unwrapped data.
 * utils.postJson(baseUrl, apiPath, body) returns normalized { ok, httpStatus, data, error, raw }.
 * data is already the SDK envelope's .data (unwrapped by normalizeResponse).
 */
async function callAction(baseUrl, actionPath, params = {}) {
  const resp = await postJson(baseUrl, actionPath, params);
  if (!resp.ok) {
    throw new Error(`Device API error [${actionPath}]: ${resp.error || `HTTP ${resp.httpStatus}`}`);
  }
  return resp.data;
}

/** Get full accessibility dump of current screen (raw JSON nodes). */
async function dump(baseUrl) {
  return callAction(baseUrl, 'accessibility/dump');
}

/** Get compact visible-area dump with hierarchy (text format).
 *  Always returns a string. If the device returns non-string data
 *  (e.g., empty object on permission pages), returns empty string
 *  rather than letting the raw value leak to callers. */
async function dumpCompact(baseUrl) {
  const data = await callAction(baseUrl, 'accessibility/dump_compact');
  return typeof data === 'string' ? data : '';
}

/**
 * Query nodes by selector without performing an action.
 * Returns { count, nodes }.
 */
async function queryNodes(baseUrl, selector) {
  return callAction(baseUrl, 'accessibility/node', {
    selector: normalizeSelectorForRuntime(selector),
  });
}

/**
 * Perform an action on a node matching selector.
 * Returns node action result data.
 */
async function actOnNode(baseUrl, selector, action, extraParams = {}) {
  return callAction(baseUrl, 'accessibility/node', {
    selector: normalizeSelectorForRuntime(selector),
    action,
    ...extraParams,
  });
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Scroll using bezier gesture. direction: up|down|left|right. */
async function scrollBezier(baseUrl, { direction, bounds, distance, screenSize }) {
  // Use screen size for default bounds if available, else fallback
  const sw = screenSize?.width || 1080;
  const sh = screenSize?.height || 2400;
  const b = bounds || { left: Math.round(sw * 0.1), top: Math.round(sh * 0.2), right: Math.round(sw * 0.9), bottom: Math.round(sh * 0.85) };

  // Default distance = 30% of scrollable area height/width
  const scrollableH = b.bottom - b.top;
  const scrollableW = b.right - b.left;
  const isVertical = direction === 'up' || direction === 'down';
  const defaultDist = Math.round((isVertical ? scrollableH : scrollableW) * 0.3);
  const dist = distance || defaultDist;

  // Randomize center and distance to simulate human behavior
  const cx = randInt(b.left + 30, b.right - 30);
  const cy = randInt(Math.round((b.top + b.bottom) / 2) - 50, Math.round((b.top + b.bottom) / 2) + 50);
  const half = Math.round(dist / 2) + randInt(-30, 30);
  const dur = 300 + randInt(0, 200);

  // Direction = content scroll direction (not finger gesture direction).
  // "down" = see content below = finger swipes up = startY > endY
  const points = {
    down: { startX: cx, startY: cy + half, endX: cx + randInt(-15, 15), endY: cy - half },
    up: { startX: cx, startY: cy - half, endX: cx + randInt(-15, 15), endY: cy + half },
    right: { startX: cx + half, startY: cy, endX: cx - half, endY: cy + randInt(-15, 15) },
    left: { startX: cx - half, startY: cy, endX: cx + half, endY: cy + randInt(-15, 15) },
  };
  const p = points[direction];
  if (!p) throw new Error(`Invalid scroll direction: ${direction}. Use up/down/left/right`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return callAction(baseUrl, 'input/scroll_bezier', {
    start_x: clamp(p.startX, b.left, b.right),
    start_y: clamp(p.startY, b.top, b.bottom),
    end_x: clamp(p.endX, b.left, b.right),
    end_y: clamp(p.endY, b.top, b.bottom),
    duration: dur,
  });
}

/** Execute one workflow step synchronously through the real workflow engine. */
async function runWorkflowStep(baseUrl, step) {
  return callAction(baseUrl, 'workflow/run_step', normalizeRuntimePayload(step || {}));
}

/** Launch an app by package name. */
async function launchApp(baseUrl, packageName) {
  return callAction(baseUrl, 'activity/launch_app', {
    package_name: packageName,
  });
}

/** Send a key event (e.g. HOME = 3, BACK = 4). */
async function keyEvent(baseUrl, keyCode) {
  return callAction(baseUrl, 'input/keyevent', { key_code: keyCode });
}

/** Get the current top activity info. */
async function topActivity(baseUrl) {
  return callAction(baseUrl, 'activity/top_activity');
}

/** Get display dimensions (width, height, rotation). */
async function displayInfo(baseUrl) {
  return callAction(baseUrl, 'display/info');
}

/** List installed packages. type: "all", "system", or "user" (default). */
async function listPackages(baseUrl, type = 'user') {
  return callAction(baseUrl, 'package/list', { type });
}

/** Stop all apps and return to home screen. */
async function stopAllApps(baseUrl) {
  return callAction(baseUrl, 'activity/stop_all_apps', { back_home: true });
}

/**
 * Step 0: Reset device to a clean home screen.
 * 1. stop_all_apps
 * 2. Wait 5s for system to settle
 * 3. Press HOME to ensure home screen
 * 4. Wait 1s
 * 5. dump to confirm
 */
/** Grant all runtime permissions to a package. Silent no-op if it fails. */
async function grantAllPermissions(baseUrl, packageName) {
  if (!packageName) return;
  try {
    await callAction(baseUrl, 'permission/set', {
      package_name: packageName,
      grant: true,
      grant_all: true,
    });
  } catch (_) {
    // Best-effort: some devices may not support this API.
    // Permission dialogs will be caught by exception_handlers at runtime.
  }
}

async function resetDevice(baseUrl) {
  await stopAllApps(baseUrl);
  await sleep(5000);
  await keyEvent(baseUrl, 3); // HOME
  await sleep(1000);
  return dump(baseUrl);
}

module.exports = {
  dump,
  dumpCompact,
  queryNodes,
  actOnNode,
  scrollBezier,
  displayInfo,
  grantAllPermissions,
  listPackages,
  runWorkflowStep,
  launchApp,
  keyEvent,
  topActivity,
  resetDevice,
  sleep,
};
