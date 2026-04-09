'use strict';

const DEFAULT_SETTLE_DELAYS_MS = [1000, 2000, 3000];
const SEMANTIC_LOOP_DEFAULTS = Object.freeze({
  navigate: { max_count: 5, interval: 1200 },
  seek: { max_count: 4, interval: 800 },
  reveal: { max_count: 4, interval: 1000 },
  verify: { max_count: 3, interval: 1000 },
});
const FAILURE_CATEGORIES = Object.freeze({
  PRECONDITION_MISMATCH: 'precondition_mismatch',
  PAGE_NOT_STABLE: 'page_not_stable',
  SELECTOR_NOT_FOUND: 'selector_not_found',
  SELECTOR_AMBIGUOUS: 'selector_ambiguous',
  POSTCONDITION_MISMATCH: 'postcondition_mismatch',
  COORDINATE_DRIFT: 'coordinate_drift',
  HANDLER_MISSING: 'handler_missing',
  RUNTIME_TIMEOUT: 'runtime_timeout',
});

function classifyActionKind(action) {
  if (action?.path === 'activity/launch_app') {
    return 'launch';
  }
  if (action?.path === 'input/scroll_bezier') {
    return 'scroll';
  }
  if (action?.path === 'input/text') {
    return 'text_input';
  }
  if (action?.path === 'input/keyevent') {
    return 'keyevent';
  }
  if (action?.path === 'input/click' && action?.params?.x !== undefined && action?.params?.y !== undefined) {
    return 'coordinate_click';
  }
  if (action?.path === 'accessibility/node' && action?.params?.action) {
    // Classify by the specific node action, not just "has action param"
    const nodeAction = action.params.action;
    if (nodeAction === 'set_text' || nodeAction === 'clear_text') return 'node_text_input';
    if (nodeAction === 'long_click') return 'node_long_click';
    return 'node_click';  // click, focus, select, etc.
  }
  if (action?.path === 'accessibility/node') {
    return 'node_query';
  }
  return 'unknown';
}

module.exports = {
  DEFAULT_SETTLE_DELAYS_MS,
  SEMANTIC_LOOP_DEFAULTS,
  FAILURE_CATEGORIES,
  classifyActionKind,
};
