'use strict';

const { classifyActionKind } = require('./reliability_policy');

const POLICY_ISSUE_CODES = Object.freeze({
  MISSING_ARRIVAL_PROOF: 'missing_arrival_proof',
  MISSING_OBSERVABLE_POSTCONDITION: 'missing_observable_postcondition',
  RAW_TRANSCRIPT_NOT_MERGED: 'raw_transcript_not_merged',
  HANDLER_SHOULD_BE_PROMOTED: 'handler_should_be_promoted',
  TERMINAL_VERIFY_MISSING: 'terminal_verify_missing',
  EVIDENCE_INSUFFICIENT: 'evidence_insufficient',
  WEAK_SHIPPED_SELECTOR: 'weak_shipped_selector',
  SCHEMA_FIELD_MISPLACED: 'schema_field_misplaced',
  COORDINATE_IN_VERIFY_SELECTOR: 'coordinate_in_verify_selector',
  LOOP_INTERVAL_MISSING: 'loop_interval_missing',
  LOOP_INTERVAL_TOO_SHORT: 'loop_interval_too_short',
});

const MIN_BARRIER_SLEEP_MS = 1000;
const MIN_VERIFY_WAIT_TIMEOUT_MS = 5000;
// Every compiled loop must pause between iterations to avoid overwhelming the UI.
// Below 800 ms the device cannot consistently settle between scroll/seek gestures.
const MIN_LOOP_INTERVAL_MS = 800;
// Default interval injected by the compiler when auto-generating scroll macro loops.
const DEFAULT_MACRO_SCROLL_INTERVAL_MS = 1000;

// Local clone — cannot import from utils.js due to circular dependency (utils → semantic_policy).
function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function selectorKey(selector) {
  return JSON.stringify(selector || {});
}

function selectorLeafResourceId(resourceId) {
  const value = String(resourceId || '');
  const markerIndex = value.lastIndexOf(':id/');
  if (markerIndex >= 0) {
    return value.slice(markerIndex + 4);
  }
  const slashIndex = value.lastIndexOf('/');
  if (slashIndex >= 0) {
    return value.slice(slashIndex + 1);
  }
  return value;
}

function isOpaqueResourceId(resourceId) {
  const leaf = selectorLeafResourceId(resourceId).trim();
  if (!leaf) {
    return false;
  }
  if (!/^[a-z0-9_]+$/i.test(leaf)) {
    return false;
  }
  if (leaf.length <= 3) {
    return true;
  }
  return leaf.length <= 4 && /\d/.test(leaf);
}

function selectorHasPositionalFields(selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return false;
  }
  return [
    'center_x',
    'center_y',
    'x',
    'y',
    'left',
    'top',
    'right',
    'bottom',
    'bounds',
  ].some((key) => selector[key] !== undefined);
}

function selectorProofScore(selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return -1;
  }

  let score = 0;
  if (selector.text) {
    score += 100;
  }
  if (selector.content_desc) {
    score += 90;
  }
  if (selector.resource_id) {
    score += isOpaqueResourceId(selector.resource_id) ? 10 : 60;
  }
  if (selector.class_name) {
    score -= 5;
  }
  if (selectorHasPositionalFields(selector)) {
    score -= 100;
  }

  return score;
}

function isProofCapableSelector(selector) {
  return selectorProofScore(selector) > 0;
}

/**
 * Whether an element is worth highlighting to the agent in observation output.
 * Used by all observation formatters (walk diff, dump annotations) as the
 * single definition of "agent-relevant element."
 *
 * The threshold adapts to page context:
 * - If the page has text/content_desc elements → only mark those (score > 60)
 * - If the page has NO text/content_desc → fall back to marking meaningful
 *   resource_ids too (score > 10)
 *
 * This prevents "no marks at all" on icon-heavy apps where resource_id
 * is the only stable identifier.
 *
 * Call computeRelevanceThreshold() once per page, then pass the threshold
 * to isAgentRelevant().
 */
function computeRelevanceThreshold(selectors) {
  const hasRichElements = selectors.some(sel => selectorProofScore(sel) > 60);
  return hasRichElements ? 60 : 10;
}

/**
 * Whether an element is worth highlighting to the agent.
 * @param {object} selector - Element selector object
 * @param {number} [threshold=60] - From computeRelevanceThreshold(). Default 60 = text/content_desc only.
 */
function isAgentRelevant(selector, threshold) {
  const t = threshold !== undefined ? threshold : 60;
  return selectorProofScore(selector) > t;
}

function selectorsEqual(left, right) {
  return selectorKey(left) === selectorKey(right);
}

function buildPolicyIssue(code, message, details = {}) {
  return {
    code,
    message,
    details: clone(details) || {},
  };
}

function createPolicyError(code, message, details = {}) {
  const issue = buildPolicyIssue(code, message, details);
  const error = new Error(message);
  error.code = issue.code;
  error.details = issue.details;
  error.policyIssue = issue;
  return error;
}

function uniqueSelectors(selectors) {
  const unique = [];
  const seen = new Set();

  for (const selector of selectors || []) {
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
      continue;
    }
    const key = selectorKey(selector);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(clone(selector));
  }

  return unique;
}

function isLaunchAction(action) {
  return action?.path === 'activity/launch_app';
}

function isBarrierSleepAction(action) {
  return action?.path === 'base/sleep';
}

function isNodeVerifyAction(action) {
  return action?.path === 'accessibility/node' && !action?.params?.action;
}

function isArrivalProofAction(action) {
  return isNodeVerifyAction(action);
}

function isSideEffectingAction(action) {
  return [
    'launch',
    'scroll',
    'text_input',
    'node_text_input',
    'keyevent',
    'coordinate_click',
    'node_click',
    'node_long_click',
  ].includes(classifyActionKind(action));
}

function isMechanicalOnlyAction(action) {
  return isBarrierSleepAction(action) || isSideEffectingAction(action);
}

function sleepDuration(action) {
  const value = Number(action?.params?.duration);
  return Number.isFinite(value) ? value : null;
}

function waitTimeout(action) {
  const value = Number(action?.params?.wait_timeout);
  return Number.isFinite(value) ? value : null;
}

function hasNodesThrowIfEmpty(action) {
  return Array.isArray(action?.throw_if_empty) && action.throw_if_empty.includes('nodes');
}

function collectStepSelectors(step) {
  const selectors = [];
  const actions = step?.actions || step?.confirmed_actions || [];

  if (Array.isArray(actions) && actions.length > 0) {
    for (const action of actions) {
      if (isNodeVerifyAction(action) && action?.params?.selector) {
        selectors.push(action.params.selector);
      }
    }
    return uniqueSelectors(selectors);
  }

  if (step?.verify_selector) {
    selectors.push(step.verify_selector);
  }
  if (step?.success_condition?.selector) {
    selectors.push(step.success_condition.selector);
  }
  for (const selector of step?.observed_selectors || []) {
    selectors.push(selector);
  }

  return uniqueSelectors(selectors);
}

function hasObservablePostcondition(step) {
  if (collectStepSelectors(step).length > 0) {
    return true;
  }
  const actions = step?.actions || step?.confirmed_actions || [];
  return Array.isArray(actions) && actions.some(
    (action) => isNodeVerifyAction(action) && hasNodesThrowIfEmpty(action)
  );
}

function getLoop(step) {
  if (step?.loop) {
    return step.loop;
  }
  if (step?.compiler_hints?.loop_hint) {
    return step.compiler_hints.loop_hint;
  }
  if (step?.loop_hint) {
    return step.loop_hint;
  }
  return null;
}

function getIntentType(step) {
  return step?.intent_type
    || step?.semantic_type
    || step?.compiler_hints?.intent_type
    || step?.metadata?.intent_type
    || null;
}

function hasFixedCountLoop(step) {
  const loop = getLoop(step);
  return Number.isInteger(loop?.count) && loop.count >= 1;
}

function isExplicitMacroStep(step) {
  return getIntentType(step) === 'macro' && hasFixedCountLoop(step);
}

function satisfiesFinalCheck({ terminalStep, terminalSelectors }) {
  // Terminal step has a verify action with throw_if_empty → pass
  const actions = terminalStep?.actions || terminalStep?.confirmed_actions || [];
  const hasVerify = actions.some(
    (action) => action?.path === 'accessibility/node'
      && !action?.params?.action
      && Array.isArray(action?.throw_if_empty)
      && action.throw_if_empty.length > 0
  );

  if (hasVerify) {
    return {
      satisfied: true,
      source: 'terminal_step',
      selector: null,
      candidate_selector: null,
      reason: null,
    };
  }

  // Check terminal page candidates
  const candidateSelectors = uniqueSelectors(terminalSelectors);
  if (candidateSelectors.length > 0) {
    return {
      satisfied: false,
      source: null,
      selector: null,
      candidate_selector: clone(candidateSelectors[0]),
      reason: 'evidence_insufficient',
    };
  }

  return {
    satisfied: false,
    source: null,
    selector: null,
    candidate_selector: null,
    reason: 'evidence_insufficient',
  };
}

module.exports = {
  MIN_BARRIER_SLEEP_MS,
  MIN_VERIFY_WAIT_TIMEOUT_MS,
  MIN_LOOP_INTERVAL_MS,
  DEFAULT_MACRO_SCROLL_INTERVAL_MS,
  POLICY_ISSUE_CODES,
  buildPolicyIssue,
  collectStepSelectors,
  createPolicyError,
  getIntentType,
  hasFixedCountLoop,
  hasNodesThrowIfEmpty,
  hasObservablePostcondition,
  isArrivalProofAction,
  isBarrierSleepAction,
  isExplicitMacroStep,
  isLaunchAction,
  isMechanicalOnlyAction,
  isNodeVerifyAction,
  isOpaqueResourceId,
  computeRelevanceThreshold,
  isAgentRelevant,
  isProofCapableSelector,
  isSideEffectingAction,
  selectorKey,
  selectorProofScore,
  sleepDuration,
  satisfiesFinalCheck,
  uniqueSelectors,
  waitTimeout,
};
