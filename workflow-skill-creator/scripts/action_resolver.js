'use strict';

/**
 * Action Resolver
 *
 * Translates agent-friendly shortcut flags into device API action JSON.
 * Walk function calls resolveAction() once — all shortcut logic lives here.
 *
 * Shortcuts:
 *   --selector '{"text":"X"}'  → accessibility/node click
 *   --scroll down              → scroll_bezier with auto-calculated coordinates
 *   --key BACK                 → input/keyevent with named key codes
 *   --launch <package>         → activity/launch_app
 *   --input "text" --target .. → accessibility/node set_text
 *   --action '{...}'           → passthrough (raw JSON)
 *
 * Adding a new shortcut = adding one resolver function here.
 * Walk function never changes for new shortcuts.
 */

const NAMED_KEYS = {
  HOME: 3, BACK: 4,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23,
  VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26,
  TAB: 61, ENTER: 66, DELETE: 67, MENU: 82, ESCAPE: 111,
  RECENTS: 187,
};

/**
 * Resolve agent args into a device action JSON object.
 * @param {object} args - CLI args (action, selector, scroll, key, launch, input, target)
 * @param {object} [deviceContext] - { screenWidth, screenHeight } from displayInfo
 * @returns {{ action: object, source: string }} - action JSON + which shortcut resolved it
 */
function resolveAction(args, deviceContext = {}) {
  // Raw JSON passthrough (highest priority)
  if (args.action) {
    const action = parseJson(args.action, '--action');
    return { action, source: 'action' };
  }

  // --selector: click shortcut
  if (args.selector) {
    const sel = parseJson(args.selector, '--selector');
    return {
      action: { path: 'accessibility/node', params: { selector: sel, action: 'click' } },
      source: 'selector',
    };
  }

  // --scroll: directional scroll with auto-calculated coordinates
  if (args.scroll) {
    const action = buildScrollAction(args.scroll, deviceContext);
    return { action, source: 'scroll' };
  }

  // --key: named key event
  if (args.key) {
    const action = buildKeyAction(args.key);
    return { action, source: 'key' };
  }

  // --launch: app launch
  if (args.launch) {
    return {
      action: { path: 'activity/launch_app', params: { package_name: args.launch } },
      source: 'launch',
    };
  }

  // --input: text input into a target element
  if (args.input !== undefined) {
    if (!args.target) throw new Error('--input requires --target selector JSON');
    const sel = parseJson(args.target, '--target');
    return {
      action: {
        path: 'accessibility/node',
        params: { selector: sel, action: 'set_text', action_params: { text: String(args.input) } },
      },
      source: 'input',
    };
  }

  return null;
}

function buildScrollAction(direction, ctx) {
  const VALID = ['up', 'down', 'left', 'right'];
  if (!VALID.includes(direction)) {
    throw new Error(`Invalid --scroll direction: ${direction}. Use ${VALID.join('/')}`);
  }

  const sw = ctx.screenWidth || 1080;
  const sh = ctx.screenHeight || 2400;
  const cx = Math.round(sw / 2);
  const scrollTop = Math.round(sh * 0.3);
  const scrollBottom = Math.round(sh * 0.7);

  const params = {
    down:  { start_x: cx, start_y: scrollBottom, end_x: cx, end_y: scrollTop, duration: 400 },
    up:    { start_x: cx, start_y: scrollTop, end_x: cx, end_y: scrollBottom, duration: 400 },
    left:  { start_x: Math.round(sw * 0.7), start_y: Math.round(sh / 2), end_x: Math.round(sw * 0.3), end_y: Math.round(sh / 2), duration: 400 },
    right: { start_x: Math.round(sw * 0.3), start_y: Math.round(sh / 2), end_x: Math.round(sw * 0.7), end_y: Math.round(sh / 2), duration: 400 },
  };

  return { path: 'input/scroll_bezier', params: params[direction] };
}

function buildKeyAction(key) {
  // Accept named keys (BACK, HOME) or numeric codes
  const code = NAMED_KEYS[key.toUpperCase()] || parseInt(key, 10);
  if (Number.isNaN(code)) {
    throw new Error(`Unknown --key: ${key}. Use a name (${Object.keys(NAMED_KEYS).join('/')}) or numeric code`);
  }
  return { path: 'input/keyevent', params: { key_code: code } };
}

function parseJson(raw, flag) {
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) {
    throw new Error(`Invalid ${flag} JSON: ${e.message}`);
  }
}

module.exports = { resolveAction, NAMED_KEYS };
