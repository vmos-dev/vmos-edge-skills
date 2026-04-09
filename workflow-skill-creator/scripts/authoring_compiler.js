'use strict';

const path = require('path');
const {
  classifyActionKind,
  DEFAULT_SETTLE_DELAYS_MS,
} = require('./reliability_policy');
const policy = require('./semantic_policy');
const {
  clone,
  jsonStringEscape,
  normalizeRetryPolicy,
  readJson,
  readText,
  renderTemplateString,
  writeText,
} = require('./utils');

const DEFAULT_BARRIER_SLEEP_MS = Math.max(DEFAULT_SETTLE_DELAYS_MS[0] || 0, policy.MIN_BARRIER_SLEEP_MS);
const MIN_VERIFY_WAIT_TIMEOUT_MS = policy.MIN_VERIFY_WAIT_TIMEOUT_MS;
const MIN_LOOP_INTERVAL_MS = policy.MIN_LOOP_INTERVAL_MS;
const DEFAULT_MACRO_SCROLL_INTERVAL_MS = policy.DEFAULT_MACRO_SCROLL_INTERVAL_MS;
const MIN_NODE_WAIT_TIMEOUT_MS = 1200;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ESTIMATED_DURATION_MS = 5000;
const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 2000;
const DEFAULT_ACTION_OVERHEAD_MS = 250;

function getLocked(step) {
  const locked = step?.locked_evidence;
  if (!locked || !locked.confirmed_action) {
    throw new Error(`Step ${step?.id || '<unknown>'} is missing locked_evidence.confirmed_action`);
  }
  return locked;
}

function getHints(step) {
  return step?.compiler_hints || {};
}

function getPreferredVerifySelector(step) {
  const hints = getHints(step);
  const locked = getLocked(step);
  const candidates = hints.verify_candidates || [];
  if (candidates.length > 0) {
    return clone(candidates[0]);
  }
  const observed = locked.observed_selectors || [];
  if (observed.length > 0) {
    return clone(observed[0]);
  }
  return null;
}

function normalizeContractStep(step) {
  const locked = getLocked(step);
  const hints = getHints(step);
  return {
    ...step,
    status: 'confirmed',
    confirmed_action: clone(locked.confirmed_action),
    before_page: locked.before_page || null,
    after_page: locked.after_page || null,
    success: locked.success !== undefined ? locked.success : true,
    evidence: clone(locked.evidence || {}),
    observed_selectors: clone(locked.observed_selectors || []),
    intent_type: hints.intent_type || null,
    success_condition: clone(hints.success_condition || null),
    retry_policy: normalizeRetryPolicy(hints.retry_policy),
    verify_selector: getPreferredVerifySelector(step),
    loop: normalizeRetryPolicy(hints.loop_hint),
    throw_if_empty: clone(hints.throw_if_empty_hint || null),
    is_verify_step: Boolean(hints.verify_step_hint),
  };
}

function getConfirmedSteps(session) {
  const steps = (session.steps || []).map(normalizeContractStep);
  if (steps.length === 0) {
    throw new Error('Cannot compile without at least one confirmed step');
  }
  return steps;
}

function resolveAuthoringRef(skillDir, ref) {
  if (!ref) {
    return null;
  }
  if (path.isAbsolute(ref)) {
    return ref;
  }
  const normalized = String(ref).replace(/^authoring\//, '');
  return path.join(skillDir, 'authoring', normalized);
}

function loadSnapshot(skillDir, ref) {
  const resolved = resolveAuthoringRef(skillDir, ref);
  if (!resolved) {
    return null;
  }
  return readJson(resolved, null);
}

// Use the canonical uniqueSelectors from semantic_policy to avoid duplication.
const uniqueSelectors = policy.uniqueSelectors;

function selectorFromNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (node.content_desc) {
    return { content_desc: node.content_desc };
  }
  if (node.text) {
    return { text: node.text };
  }
  if (node.resource_id) {
    return { resource_id: node.resource_id };
  }
  return null;
}

function collectProofSelectors(beforeSnapshot, afterSnapshot) {
  const beforeSelectors = new Set(uniqueSelectors([
    ...(beforeSnapshot?.anchors || []),
    ...((beforeSnapshot?.key_nodes || []).map(selectorFromNode).filter(Boolean)),
  ]).map(policy.selectorKey));

  const candidates = uniqueSelectors([
    ...(afterSnapshot?.anchors || []),
    ...((afterSnapshot?.key_nodes || []).map(selectorFromNode).filter(Boolean)),
  ]).filter((selector) => policy.isProofCapableSelector(selector));

  return candidates
    .map((selector, index) => ({
      selector,
      fresh: !beforeSelectors.has(policy.selectorKey(selector)),
      score: policy.selectorProofScore(selector),
      index,
    }))
    .sort((left, right) => (
      Number(right.fresh) - Number(left.fresh)
      || right.score - left.score
      || left.index - right.index
    ))
    .map((item) => item.selector);
}

function deriveVerifySelector(beforeSnapshot, afterSnapshot) {
  const proofSelectors = collectProofSelectors(beforeSnapshot, afterSnapshot);
  return proofSelectors.length > 0 ? clone(proofSelectors[0]) : null;
}

function isNodeAction(action) {
  return action?.path === 'accessibility/node' && action?.params?.selector;
}

function isNodeClickAction(action) {
  return isNodeAction(action) && ['click', 'long_click'].includes(action?.params?.action);
}

function isNodeQueryAction(action) {
  return isNodeAction(action) && !action?.params?.action;
}

function extractPositiveMsList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function sumMs(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function getStepEvidence(step) {
  return step?.evidence || {};
}

function getSampleWindowMs(step) {
  const sampleWindowMs = Number(getStepEvidence(step).sample_window_ms);
  if (Number.isFinite(sampleWindowMs) && sampleWindowMs > 0) {
    return sampleWindowMs;
  }
  return sumMs(extractPositiveMsList(getStepEvidence(step).wait_delays_ms));
}

function getObservedSettleMs(step) {
  const observedSettleMs = Number(getStepEvidence(step).observed_settle_ms);
  if (Number.isFinite(observedSettleMs) && observedSettleMs > 0) {
    return observedSettleMs;
  }
  return getSampleWindowMs(step);
}

function deriveBarrierSleepMs(step) {
  const observedSettleMs = getObservedSettleMs(step);
  if (observedSettleMs > 0) {
    return Math.max(DEFAULT_BARRIER_SLEEP_MS, observedSettleMs);
  }
  return DEFAULT_BARRIER_SLEEP_MS;
}

function deriveNodeWaitTimeoutMs(step) {
  const observedSettleMs = getObservedSettleMs(step);
  if (observedSettleMs > 0) {
    // Use observed settle time as the floor — capping at MIN_VERIFY_WAIT_TIMEOUT_MS
    // would make node waits shorter than the actual settle time, causing race conditions.
    return Math.max(MIN_NODE_WAIT_TIMEOUT_MS, observedSettleMs);
  }
  return MIN_NODE_WAIT_TIMEOUT_MS;
}

function deriveVerifyWaitTimeoutMs(step) {
  const observedSettleMs = getObservedSettleMs(step);
  if (observedSettleMs > 0) {
    return Math.max(MIN_VERIFY_WAIT_TIMEOUT_MS, observedSettleMs + 2000);
  }
  return MIN_VERIFY_WAIT_TIMEOUT_MS;
}

function withNodeWait(action, waitTimeout = MIN_NODE_WAIT_TIMEOUT_MS, waitInterval = 300) {
  const next = clone(action);
  next.params = { ...(next.params || {}) };
  if (next.params.wait_timeout === undefined) {
    next.params.wait_timeout = waitTimeout;
  }
  if (next.params.wait_interval === undefined) {
    next.params.wait_interval = waitInterval;
  }
  return next;
}

function withActionResultCheck(action) {
  const next = clone(action);
  if (!next.throw_if_empty) {
    next.throw_if_empty = ['nodes'];
  }
  return next;
}

/**
 * Ensure launch actions include grant_all_permissions.
 * Permissions are infrastructure — the compiled child skill should never
 * trigger a permission dialog during blind runtime execution.
 */
function withPermissionGrant(action) {
  if (action?.path !== 'activity/launch_app') return action;
  const next = clone(action);
  next.params = { ...(next.params || {}), grant_all_permissions: true };
  return next;
}

function buildVerifyAction(selector, step) {
  return {
    path: 'accessibility/node',
    params: {
      selector: clone(selector),
      wait_timeout: deriveVerifyWaitTimeoutMs(step),
      wait_interval: 300,
    },
    throw_if_empty: ['nodes'],
  };
}

function buildSleepAction(duration = DEFAULT_BARRIER_SLEEP_MS) {
  return {
    path: 'base/sleep',
    params: { duration },
  };
}

function createCompilerPolicyError(code, message, details = {}) {
  return policy.createPolicyError(code, message, details);
}

function deriveLoop(step, fallbackLoop) {
  return clone(
    normalizeRetryPolicy(step.loop)
    || normalizeRetryPolicy(step.retry_policy)
    || normalizeRetryPolicy(fallbackLoop)
    || null
  );
}

function isVerificationEquivalent(action, verifySelector) {
  return isNodeQueryAction(action) && policy.selectorKey(action.params.selector) === policy.selectorKey(verifySelector);
}

function insertBarrierSleeps(actions, barrierSleepMs = DEFAULT_BARRIER_SLEEP_MS) {
  const normalized = [];

  for (let index = 0; index < actions.length; index += 1) {
    const action = clone(actions[index]);
    const nextAction = actions[index + 1] || null;

    normalized.push(action);

    if (
      nextAction
      && policy.isSideEffectingAction(action)
      && nextAction.path !== 'base/sleep'
    ) {
      normalized.push(buildSleepAction(barrierSleepMs));
    }
  }

  return normalized;
}

function describeSelector(selector) {
  if (!selector) {
    return 'target';
  }
  if (selector.resource_id) return selector.resource_id;
  if (selector.content_desc) return selector.content_desc;
  if (selector.text) return selector.text;
  return JSON.stringify(selector);
}

function inferIntentType(step, verifySelector) {
  if (step.intent_type) {
    return step.intent_type;
  }

  const actionKind = classifyActionKind(step.confirmed_action);
  if (actionKind === 'launch') {
    return 'launch';
  }
  if (actionKind === 'coordinate_click' || actionKind === 'node_click') {
    if (verifySelector || step.postcondition_page_id) {
      return 'navigate';
    }
  }
  if (['text_input', 'node_text_input', 'keyevent'].includes(actionKind)) {
    return 'act';
  }
  if (actionKind === 'node_query') {
    return 'verify';
  }
  return null;
}

function enrichConfirmedStep(skillDir, step) {
  const beforeSnapshot = loadSnapshot(skillDir, step.before_page);
  const afterSnapshot = loadSnapshot(skillDir, step.after_page);
  const derivedVerify = deriveVerifySelector(beforeSnapshot, afterSnapshot);
  return {
    ...step,
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    derived_verify_selector: derivedVerify,
    provenance: {
      verify_selector: step.verify_selector ? 'author' : (derivedVerify ? 'compiler' : 'none'),
      intent_type: step.intent_type ? 'author' : 'compiler',
      action: 'author',
    },
  };
}

function collectTerminalSelectors(step) {
  if (step?.after_snapshot_transient) {
    return [];
  }

  const selectors = [];
  const seen = new Set();

  function add(selector) {
    if (!selector) {
      return;
    }
    const key = policy.selectorKey(selector);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    selectors.push(clone(selector));
  }

  for (const anchor of step?.after_snapshot?.anchors || []) {
    add(anchor);
  }
  for (const node of step?.after_snapshot?.key_nodes || []) {
    add(selectorFromNode(node));
  }

  return selectors;
}

function normalizeSingleStep(step) {
  const primaryAction = clone(step.confirmed_action);
  const verifySelector = step.verify_selector || null;
  const actionKind = classifyActionKind(primaryAction);
  const actions = [];
  const barrierSleepMs = deriveBarrierSleepMs(step);
  const fixedCountMacro = policy.isExplicitMacroStep(step);

  if (actionKind === 'coordinate_click' && !verifySelector && !step.postcondition_page_id) {
    throw new Error(`Step ${step.id} is not shippable: coordinate click lacks stable verification`);
  }

  let nextPrimaryAction = withPermissionGrant(primaryAction);
  if (isNodeClickAction(nextPrimaryAction)) {
    nextPrimaryAction = withActionResultCheck(withNodeWait(nextPrimaryAction, deriveNodeWaitTimeoutMs(step)));
  } else if (isNodeQueryAction(nextPrimaryAction)) {
    nextPrimaryAction = withActionResultCheck(withNodeWait(nextPrimaryAction, deriveVerifyWaitTimeoutMs(step)));
  }

  if (step.throw_if_empty) {
    // Normalize: boolean true → ["nodes"] (engine ignores boolean values).
    nextPrimaryAction.throw_if_empty = Array.isArray(step.throw_if_empty)
      ? clone(step.throw_if_empty)
      : ['nodes'];
  }

  actions.push(nextPrimaryAction);

  // Any step with a verify_selector gets a verify action unless the primary
  // action already proves the same thing or it is a fixed-count macro.  The
  // old code used a whitelist of intent_types which silently dropped proof for
  // 'act' and any future intent types.  verify_selector strength is enforced
  // at walk time (validateWalkInputs), so all verify selectors here are already
  // guaranteed to meet the proof-score threshold.
  const shouldAddVerifyAction = Boolean(
    verifySelector
    && !isVerificationEquivalent(nextPrimaryAction, verifySelector)
    && !fixedCountMacro
  );

  if (shouldAddVerifyAction) {
    actions.push(buildVerifyAction(verifySelector, step));
  }

  const confirmedActions = insertBarrierSleeps(actions, barrierSleepMs);

  const intentType = inferIntentType(step, verifySelector);
  const seekFallbackLoop = (intentType === 'seek' || intentType === 'reveal')
    ? { max_count: 5, interval: 800 }
    : null;
  const loop = deriveLoop(step, seekFallbackLoop);
  const isVerifyStep = Boolean(
    step.is_verify_step
    || loop
  );

  return {
    ...step,
    intent_type: intentType,
    confirmed_actions: confirmedActions,
    confirmed_action: confirmedActions[0],
    verify_selector: verifySelector,
    terminal_selectors: collectTerminalSelectors(step),
    loop,
    is_verify_step: isVerifyStep,
  };
}

// Merges a scroll (or macro-scroll) step followed by a click step into a single
// seek step when they share the same business goal: "scroll until target visible,
// then click it."  The resulting step carries both actions and a retry loop so
// the engine can scroll→click→verify in a single bounded unit.
function mergeSeekPatternPass(steps) {
  const result = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    const nextStep = steps[i + 1];

    // Detect: scroll/macro step whose original intent is seek/reveal,
    // immediately followed by a click step targeting the sought element.
    const isScrollStep = step.confirmed_action?.path === 'input/scroll_bezier'
      || policy.isExplicitMacroStep(step);
    const originalIntent = step._original_intent_type || step.intent_type;
    const isSeekIntent = ['seek', 'reveal'].includes(originalIntent);
    const nextIsClick = nextStep && isNodeClickAction(nextStep.confirmed_action);

    if (isScrollStep && isSeekIntent && nextIsClick) {
      const scrollLoop = step.loop || {};
      const scrollCount = scrollLoop.max_count || scrollLoop.count || 1;

      // Use the longer observed settle time from either step so that
      // barrier sleeps and wait timeouts are not under-estimated.
      const scrollSettle = Number(step.evidence?.observed_settle_ms) || 0;
      const clickSettle = Number(nextStep.evidence?.observed_settle_ms) || 0;
      const mergedEvidence = clickSettle > scrollSettle
        ? clone(nextStep.evidence || {})
        : clone(step.evidence || {});

      result.push({
        ...step,
        id: nextStep.id || step.id,
        description: nextStep.description || step.description,
        _original_intent_type: originalIntent,
        intent_type: 'seek',
        _seek_target_action: clone(nextStep.confirmed_action),
        verify_selector: nextStep.verify_selector || step.verify_selector,
        // Carry the click step's post-action state — this is the true
        // outcome of the merged seek (destination page, not scrolled list).
        after_page: nextStep.after_page || step.after_page,
        after_snapshot: nextStep.after_snapshot || step.after_snapshot,
        evidence: mergedEvidence,
        // Preserve click step metadata that the scroll step lacks.
        postcondition_page_id: nextStep.postcondition_page_id || step.postcondition_page_id,
        success_condition: nextStep.success_condition || step.success_condition,
        loop: {
          max_count: Math.max(scrollCount + 3, 5),
          interval: scrollLoop.interval || DEFAULT_MACRO_SCROLL_INTERVAL_MS,
        },
      });
      i += 2;
    } else {
      result.push(step);
      i += 1;
    }
  }
  return result;
}

function hardenTransitionsPass(steps) {
  return steps.map((step, index) => {
    if (step.confirmed_actions) {
      // Already normalized — pass through.
      return step;
    }

    // Seek steps produced by mergeSeekPatternPass: scroll + click target + verify.
    if (step._seek_target_action) {
      const actions = [clone(step.confirmed_action)];
      const clickAction = withActionResultCheck(
        withNodeWait(clone(step._seek_target_action), deriveNodeWaitTimeoutMs(step))
      );
      actions.push(clickAction);
      if (step.verify_selector) {
        actions.push(buildVerifyAction(clone(step.verify_selector), step));
      }
      const confirmedActions = insertBarrierSleeps(actions, deriveBarrierSleepMs(step));
      return {
        ...step,
        confirmed_actions: confirmedActions,
        confirmed_action: confirmedActions[0],
        terminal_selectors: collectTerminalSelectors(step),
        is_verify_step: true,
      };
    }

    if (policy.isExplicitMacroStep(step)) {
      // Macro steps produced by mergeConsecutiveScrollsPass carry confirmed_action
      // (singular) from the base scroll step.
      const actions = [clone(step.confirmed_action)];

      // Seek/reveal macros need a verify action so the runtime loop knows when to stop.
      // Source priority: step's own verify_selector, or next step's action selector
      // (because seek's purpose is to make the next step's target visible).
      const originalIntent = step._original_intent_type || step.intent_type;
      if (['seek', 'reveal', 'macro'].includes(originalIntent) || !step.verify_selector) {
        const nextStep = steps[index + 1];
        const seekTarget = step.verify_selector
          || nextStep?.confirmed_action?.params?.selector
          || null;
        if (seekTarget) {
          actions.push(buildVerifyAction(clone(seekTarget), step));
        }
      }

      const confirmedActions = insertBarrierSleeps(actions, deriveBarrierSleepMs(step));
      return { ...step, confirmed_actions: confirmedActions };
    }
    return normalizeSingleStep(step);
  });
}

function injectFinalCheckPass(plan, session) {
  const confirmedSteps = [...plan.confirmedSteps];
  const terminalStep = confirmedSteps[confirmedSteps.length - 1];
  const finalCheck = policy.satisfiesFinalCheck({
    terminalStep,
    terminalSelectors: terminalStep?.terminal_selectors || [],
  });

  if (finalCheck.satisfied) {
    return { ...plan, confirmedSteps };
  }

  throw createCompilerPolicyError(
    policy.POLICY_ISSUE_CODES.EVIDENCE_INSUFFICIENT,
    `Terminal step ${terminalStep?.id || '<unknown>'} has no verify action with throw_if_empty. ` +
    `Record a verify-selector for the last step before compiling.`,
    { step_id: terminalStep?.id || null }
  );
}

function validateShippabilityPass(plan) {
  for (const step of plan.confirmedSteps) {
    if (step.intent_type === 'handler') {
      throw createCompilerPolicyError(
        policy.POLICY_ISSUE_CODES.HANDLER_SHOULD_BE_PROMOTED,
        `Handler step ${step.id} must be promoted into exception_handlers instead of flow`,
        { step_id: step.id }
      );
    }

    if (policy.hasFixedCountLoop(step) && !policy.isExplicitMacroStep(step)) {
      throw createCompilerPolicyError(
        policy.POLICY_ISSUE_CODES.RAW_TRANSCRIPT_NOT_MERGED,
        `Fixed-count loop step ${step.id} is missing explicit macro intent`,
        { step_id: step.id }
      );
    }

    // Steps with null intent_type that perform clicks also need postcondition proof.
    // A null intent_type means the classifier could not determine the step's purpose,
    // which makes postcondition validation even more important — not less.
    const needsPostcondition = ['launch', 'navigate', 'seek', 'reveal', 'verify'].includes(step.intent_type)
      || (step.intent_type === null && ['node_click', 'coordinate_click'].includes(classifyActionKind(step.confirmed_action)));
    if (
      needsPostcondition
      && !policy.hasObservablePostcondition(step)
    ) {
      throw createCompilerPolicyError(
        policy.POLICY_ISSUE_CODES.EVIDENCE_INSUFFICIENT,
        `Step ${step.id} is missing a proof-capable observable postcondition`,
        { step_id: step.id }
      );
    }

    // Q6: throw_if_empty must be at ActionConfig level (sibling to path/params), not inside params.
    // When placed inside params it is forwarded to the device API and silently ignored,
    // removing the failure signal that retry loops depend on.
    if (step.confirmed_action?.params?.throw_if_empty !== undefined) {
      throw createCompilerPolicyError(
        policy.POLICY_ISSUE_CODES.SCHEMA_FIELD_MISPLACED,
        `Step ${step.id}: throw_if_empty is inside params — move it to the ActionConfig level (sibling to path and params)`,
        { step_id: step.id }
      );
    }

    // Q4 / Gate 2: verify selectors must be coordinate-independent so proof survives any device.
    // center_x, center_y, and bounds are screen-position fields that change across screen sizes
    // and orientations — they cannot be used as cross-device proof.
    const verifySelector = step.verify_selector || null;
    if (verifySelector) {
      const coordFields = ['center_x', 'center_y', 'bounds'].filter(f => verifySelector[f] !== undefined);
      if (coordFields.length > 0) {
        throw createCompilerPolicyError(
          policy.POLICY_ISSUE_CODES.COORDINATE_IN_VERIFY_SELECTOR,
          `Step ${step.id}: verify_selector contains coordinate field(s) [${coordFields.join(', ')}] — use text, content_desc, or resource_id instead`,
          { step_id: step.id, coordinate_fields: coordFields }
        );
      }
    }

    // Loop interval gate: every loop must pause between iterations so the device can settle.
    // Missing interval → device may scroll/seek faster than the UI can render.
    // Interval < MIN_LOOP_INTERVAL_MS → same risk; minimum is 800 ms.
    const loop = normalizeRetryPolicy(step.loop);
    if (loop) {
      if (loop.interval === undefined || loop.interval === null) {
        throw createCompilerPolicyError(
          policy.POLICY_ISSUE_CODES.LOOP_INTERVAL_MISSING,
          `Step ${step.id}: loop is missing interval — every loop must specify an interval of at least ${MIN_LOOP_INTERVAL_MS} ms`,
          { step_id: step.id }
        );
      }
      if (loop.interval < MIN_LOOP_INTERVAL_MS) {
        throw createCompilerPolicyError(
          policy.POLICY_ISSUE_CODES.LOOP_INTERVAL_TOO_SHORT,
          `Step ${step.id}: loop interval ${loop.interval} ms is below the minimum ${MIN_LOOP_INTERVAL_MS} ms`,
          { step_id: step.id, interval: loop.interval, min_interval: MIN_LOOP_INTERVAL_MS }
        );
      }
    }
  }

  return plan;
}

// Returns a string that identifies the scroll direction so that only same-direction
// consecutive scrolls are merged (prevents merging up+down into a no-op macro).
// Returns the CONTENT scroll direction (matching device_api.scrollBezier convention).
// "down" = content moves down = finger swipes up = start_y > end_y = dy < 0.
function scrollDirectionKey(action) {
  const p = action?.params || {};
  if (p.direction) {
    return String(p.direction);
  }
  // Derive from coordinate delta. dy < 0 means finger moved up → content scrolls DOWN.
  const dy = (Number(p.end_y) || 0) - (Number(p.start_y) || 0);
  const dx = (Number(p.end_x) || 0) - (Number(p.start_x) || 0);
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy <= 0 ? 'down' : 'up';
  }
  return dx <= 0 ? 'right' : 'left';
}

// Merges runs of consecutive same-direction scroll steps into a single macro step.
// Matching is by action path + scroll direction — different directions are not merged.
// The recording AI no longer needs to manually flag scrolls with --loop.
function mergeConsecutiveScrollsPass(steps) {
  const result = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    const actionPath = step.confirmed_action?.path;
    const dirKey = actionPath === 'input/scroll_bezier'
      ? scrollDirectionKey(step.confirmed_action)
      : null;
    if (actionPath === 'input/scroll_bezier' && !step.loop) {
      const group = [step];
      while (
        i + group.length < steps.length
        && steps[i + group.length].confirmed_action?.path === actionPath
        && !steps[i + group.length].loop
        && scrollDirectionKey(steps[i + group.length].confirmed_action) === dirKey
      ) {
        group.push(steps[i + group.length]);
      }
      if (group.length > 1) {
        const base = group[0];
        // Decide loop mode from the original recording intent:
        //   seek/reveal scrolls → max_count (retry-until-found, exits early on success)
        //   macro scrolls → count (fixed repetition, always runs all iterations)
        const isSeek = group.some(s => ['seek', 'reveal'].includes(s.intent_type));
        const loopConfig = isSeek
          ? { max_count: Math.max(group.length, 5), interval: DEFAULT_MACRO_SCROLL_INTERVAL_MS }
          : { count: group.length, interval: DEFAULT_MACRO_SCROLL_INTERVAL_MS };
        result.push({
          ...base,
          _original_intent_type: base.intent_type,
          intent_type: isSeek ? base.intent_type : 'macro',
          loop: loopConfig,
          description: base.description
            ? `${base.description} ×${group.length}`
            : `Scroll ×${group.length}`,
        });
        i += group.length;
      } else if (['seek', 'reveal'].includes(step.intent_type)) {
        // Single seek/reveal scroll: wrap in retry loop (find target, not fixed repetition).
        result.push({
          ...step,
          _original_intent_type: step.intent_type,
          loop: { max_count: step.loop?.max_count || 5, interval: DEFAULT_MACRO_SCROLL_INTERVAL_MS },
        });
        i += 1;
      } else {
        result.push(step);
        i += 1;
      }
    } else {
      result.push(step);
      i += 1;
    }
  }
  return result;
}

function buildCompilationPlan({ skillDir, session }) {
  const rawConfirmedSteps = getConfirmedSteps(session).map((step) => enrichConfirmedStep(skillDir, step));
  // Deterministic compiler transformations applied in order:
  // 1. Merge consecutive identical scroll steps into macros.
  // 2. Merge scroll(+macro) + click into semantic seek steps.
  // 3. Apply sleep barriers and verify actions (hardenTransitionsPass).
  // 4. Inject final check and validate shippability.
  const mergedSteps = mergeConsecutiveScrollsPass(rawConfirmedSteps);
  const seekMergedSteps = mergeSeekPatternPass(mergedSteps);
  const hardenedSteps = hardenTransitionsPass(seekMergedSteps);
  const plan = {
    confirmedSteps: hardenedSteps,
    recoveries: (session.recoveries || []).filter((item) => item.status === 'confirmed'),
  };

  return validateShippabilityPass(injectFinalCheckPass(plan, session));
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function stripSentencePunctuation(value) {
  return normalizeWhitespace(value).replace(/[.。!！?？]+$/u, '');
}

function titleCaseAsciiWord(word) {
  if (!/^[a-z0-9]+$/i.test(word)) {
    return word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function capitalizeSentence(value) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return '';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toDisplayName(skillName) {
  const tokens = String(skillName || '')
    .split(/[-_]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return 'Workflow Child Skill';
  }

  return tokens.map(titleCaseAsciiWord).join(' ');
}

function lowerCaseIfAscii(value) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return '';
  }
  return /^[\x00-\x7F]+$/.test(text) ? text.toLowerCase() : text;
}

function uniqueStrings(values) {
  const unique = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || unique.includes(normalized)) {
      continue;
    }
    unique.push(normalized);
  }
  return unique;
}

function describeGoalSelector(selector) {
  if (!selector || typeof selector !== 'object') {
    return 'the recorded goal state is visible';
  }
  if (selector.text) {
    return `text "${selector.text}" is visible`;
  }
  if (selector.content_desc) {
    return `content description "${selector.content_desc}" is visible`;
  }
  if (selector.resource_id) {
    return `resource "${selector.resource_id}" is visible`;
  }
  return 'the recorded goal state is visible';
}

function hasLaunchAction(plan) {
  return (plan?.confirmedSteps || []).some((step) => (
    (step.confirmed_actions || []).some((action) => policy.isLaunchAction(action))
  ));
}

function inferSideEffect(plan) {
  return hasLaunchAction(plan) ? 'launches_app' : 'changes_ui_state';
}

function inferRequiresAppRunning(plan) {
  return !hasLaunchAction(plan);
}

function buildTriggerDescription(session, displayName) {
  const task = stripSentencePunctuation(session?.goal?.task || session?.task || '');
  if (task) {
    return `Use when the user wants to ${task} on the Android device.`;
  }
  return `Use when the user wants to run ${displayName} on the Android device.`;
}

// Derives the "Use when ..." trigger condition text for the SKILL.md description field.
// Pattern from child-skill-guide.md: "Use when the user wants to [business outcome] on [app name]."
// Returns the raw text so it fits naturally after "Use when ".
function deriveTriggerDescription(session, displayName) {
  const task = lowerCaseIfAscii(stripSentencePunctuation(session?.goal?.task || session?.task || ''));
  if (task) {
    return `the user wants to ${task}`;
  }
  const name = lowerCaseIfAscii(displayName) || 'run this workflow';
  return `the user wants to ${name}`;
}

// Derives a short_description for openai.yaml (25-64 chars).
// Strips double quotes (they break YAML when template wraps in "...").
// Truncates to 64 chars if needed, pads minimally if too short.
function deriveShortDescription(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').replace(/"/g, '').trim();
  if (clean.length >= 25 && clean.length <= 64) {
    return clean;
  }
  if (clean.length > 64) {
    return clean.slice(0, 61) + '...';
  }
  // Too short — pad with generic suffix
  const padded = clean || 'Android workflow automation skill';
  return padded.length >= 25 ? padded : `${padded} — Android workflow skill`;
}

// Returns the app display name from the session.
// Phase 0 resolves app_name (via packages command or user input) before init,
// so session.app_name must be set. Throw if missing — silent fallback produces
// broken child skills with "the target app" as app_name.
function getAppName(session) {
  const name = session?.app_name;
  if (!name) {
    throw new Error(
      'session.app_name is missing. Phase 0 must resolve app_name via ' +
      'the packages command before init. Cannot compile without it.'
    );
  }
  return name;
}

function buildSkillSummary(session, terminalVerifyText) {
  const task = stripSentencePunctuation(session?.goal?.task || session?.task || '');
  if (task) {
    return `${capitalizeSentence(task)} and verify ${terminalVerifyText}.`;
  }
  return `Run the compiled child workflow and verify ${terminalVerifyText}.`;
}

function buildTriggerSemantics(session, displayName) {
  const task = lowerCaseIfAscii(session?.goal?.task || session?.task || '');
  const baseName = lowerCaseIfAscii(displayName);
  const launchVariant = baseName ? `run ${baseName}` : '';
  return uniqueStrings([task, baseName, launchVariant]);
}

function buildOutcomeSection(session, terminalVerifyText) {
  const task = stripSentencePunctuation(session?.goal?.task || session?.task || '');
  const lines = [];
  if (task) {
    lines.push(`- Completes: ${task}.`);
  } else {
    lines.push('- Completes the recorded device task.');
  }
  lines.push(`- Success is proven when ${terminalVerifyText}.`);
  return lines.join('\n');
}

function buildTriggerPhrasesSection(triggerSemantics) {
  return triggerSemantics
    .map((phrase) => `- "${phrase}"`)
    .join('\n');
}

function buildFailureModesSection(plan) {
  const lines = [
    '- If runtime verification cannot prove the goal state, treat the run as failed and regenerate the child from stronger device evidence before reuse.',
  ];

  if ((plan?.recoveries || []).length > 0) {
    lines.unshift('- Known interruptions are handled by compiled `exception_handlers` before the main flow resumes.');
  }

  return lines.join('\n');
}

function templatePath(name) {
  return path.join(__dirname, '..', 'assets', name);
}

/**
 * Estimate how many loop iterations to budget for timeout calculation.
 * - Fixed count (loop.count): exact count — all iterations will run.
 * - Retry-until-success (loop.max_count + completed:"success"): the step
 *   exits early on success. Budget for ~half of max_count as the expected
 *   case, not worst-case. This prevents timeout from inflating 3-5x beyond
 *   what the workflow actually needs.
 */
function loopRepeatCount(loop, completed) {
  if (Number.isInteger(loop?.count) && loop.count > 0) {
    return loop.count;  // Fixed count: all iterations will run
  }
  if (Number.isInteger(loop?.max_count) && loop.max_count > 0) {
    if (completed === 'success') {
      // Retry-until-success: budget for expected case, not worst case.
      // Use ceil(max/2) with minimum 2 to be safe but not pessimistic.
      return Math.max(2, Math.ceil(loop.max_count / 2));
    }
    return loop.max_count;
  }
  return 1;
}

function loopIntervalBudgetMs(loop, repeatCount) {
  const interval = Number(loop?.interval);
  if (repeatCount <= 1 || !Number.isFinite(interval) || interval <= 0) {
    return 0;
  }
  return interval * (repeatCount - 1);
}

function actionRuntimeBudgetMs(action) {
  if (!action) {
    return 0;
  }

  let budget = 0;
  const waitTimeout = Number(action?.params?.wait_timeout);
  if (Number.isFinite(waitTimeout) && waitTimeout > 0) {
    budget += waitTimeout;
  }

  const sleepDuration = policy.sleepDuration(action);
  if (sleepDuration !== null) {
    budget += sleepDuration;
  }

  if (!policy.isBarrierSleepAction(action)) {
    budget += DEFAULT_ACTION_OVERHEAD_MS;
  }

  return budget;
}

function estimateStepDurationMs(step) {
  const actions = step?.confirmed_actions || [];
  const iterationBudgetMs = actions.reduce((sum, action) => sum + actionRuntimeBudgetMs(action), 0);
  // Detect retry-until-success from loop shape: has max_count but no fixed count.
  // step.completed is not available at this stage (set later in buildWorkflowSteps),
  // so infer from loop config directly.
  const loop = step?.loop;
  const isRetryUntilSuccess = loop?.max_count && !loop?.count;
  const repeatCount = loopRepeatCount(loop, isRetryUntilSuccess ? 'success' : undefined);
  return (iterationBudgetMs * repeatCount) + loopIntervalBudgetMs(loop, repeatCount);
}

function deriveRuntimeMetadata(plan) {
  const flowDurationMs = (plan?.confirmedSteps || []).reduce(
    (sum, step) => sum + estimateStepDurationMs(step),
    0
  );
  const recoveryBudgetMs = (plan?.recoveries || []).length * (MIN_VERIFY_WAIT_TIMEOUT_MS + DEFAULT_BARRIER_SLEEP_MS);
  const estimatedDurationMs = Math.max(
    DEFAULT_ESTIMATED_DURATION_MS,
    flowDurationMs + recoveryBudgetMs
  );
  const timeoutBufferMs = Math.max(10000, Math.ceil(estimatedDurationMs * 0.5));
  const timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, estimatedDurationMs + timeoutBufferMs);

  let pollIntervalMs = MIN_POLL_INTERVAL_MS;
  if (estimatedDurationMs >= 120000) {
    pollIntervalMs = MAX_POLL_INTERVAL_MS;
  } else if (estimatedDurationMs >= 45000) {
    pollIntervalMs = 1000;
  }

  return {
    estimatedDurationMs,
    timeoutMs,
    pollIntervalMs,
  };
}

function buildWorkflowSteps(plan) {
  const steps = {};
  for (const step of plan?.confirmedSteps || []) {
    const payload = {
      description: step.intent || step.id,
      actions: clone(step.confirmed_actions || []),
    };
    const loop = normalizeRetryPolicy(step.loop);
    if (loop) {
      payload.loop = loop;
      if (loop.max_count !== undefined) {
        payload.completed = 'success';
      }
    }
    steps[step.id] = payload;
  }
  return steps;
}

function sanitizeExceptionHandlerActionParams(actionParams) {
  if (!actionParams || typeof actionParams !== 'object' || Array.isArray(actionParams)) {
    return {};
  }

  const sanitized = clone(actionParams);
  delete sanitized.selector;
  delete sanitized.action;
  delete sanitized.wait_timeout;
  delete sanitized.wait_interval;
  delete sanitized.throw_if_empty;
  return sanitized;
}

function buildExceptionHandlers(plan) {
  return (plan?.recoveries || []).map((handler) => {
    const actionParams = sanitizeExceptionHandlerActionParams(handler.action_params || {});

    const payload = {
      name: handler.name || handler.id || 'recovery_handler',
      selector: clone(handler.selector || {}),
      action: handler.action || 'dismiss',
      max_trigger_count: handler.max_trigger_count || 3,
    };

    if (Object.keys(actionParams).length > 0) {
      payload.action_params = actionParams;
    }

    return payload;
  });
}

function buildEvalsPayload({ skillName, triggerSemantics, terminalVerifyText, finalStepId }) {
  return [
    {
      id: 1,
      name: skillName,
      prompt: triggerSemantics[0] || skillName,
      expected_output: terminalVerifyText,
      expectations: [
        {
          type: 'workflow_status',
          path: 'execution.status',
          equals: 'COMPLETED',
        },
        {
          type: 'json_path_exists',
          path: 'execution.execution_id',
        },
        {
          type: 'step_succeeds',
          step_id: finalStepId,
        },
      ],
    },
  ];
}

function buildChildSkillSpec({ skillDir, session, plan }) {
  const skillName = session?.skill_name || path.basename(skillDir);
  const displayName = toDisplayName(skillName);
  const skillDescription = buildTriggerDescription(session, displayName);
  const triggerSemantics = buildTriggerSemantics(session, displayName);
  const runtimeMeta = deriveRuntimeMetadata(plan);

  const workflowScript = {
    id: skillName,
    name: displayName,
    steps: buildWorkflowSteps(plan),
    flow: (plan?.confirmedSteps || []).map((step) => step.id),
    exception_handlers: buildExceptionHandlers(plan),
    timeout: runtimeMeta.timeoutMs,
  };

  // Derive goal proof text from terminal step's verify selector for SKILL.md / description only.
  // The workflow engine uses COMPLETED/FAILED status; step-level verify is the proof.
  const terminalStepId = workflowScript.flow[workflowScript.flow.length - 1];
  const terminalStepPayload = workflowScript.steps[terminalStepId];
  const terminalSelectors = policy.collectStepSelectors(terminalStepPayload);
  const terminalVerifySelector = terminalSelectors.length > 0 ? clone(terminalSelectors[0]) : null;
  const terminalVerifyText = describeGoalSelector(terminalVerifySelector);

  const summary = buildSkillSummary(session, terminalVerifyText);

  workflowScript.description = summary;

  const targetPackage = session?.goal?.target_package || session?.app || '';

  const businessSpec = {
    skillName,
    runtime: {
      pollIntervalMs: runtimeMeta.pollIntervalMs,
      timeoutMs: runtimeMeta.timeoutMs,
    },
  };

  return {
    identity: {
      skill_name: skillName,
      display_name: displayName,
      target_package: targetPackage,
    },
    skill: {
      name: skillName,
      display_name: displayName,
      description: skillDescription,
      summary,
      outcome_section: buildOutcomeSection(session, terminalVerifyText),
      trigger_phrases_section: buildTriggerPhrasesSection(triggerSemantics),
      failure_modes_section: buildFailureModesSection(plan),
    },
    trigger_semantics: triggerSemantics,
    business_spec: businessSpec,
    workflow: workflowScript,
  };
}

function buildCompiledArtifacts({ skillDir, session, plan }) {
  const spec = buildChildSkillSpec({ skillDir, session, plan });

  const skillMdTemplate = readText(templatePath('child.SKILL.md.tpl'));
  const businessSpecTemplate = readText(templatePath('child.business-spec.json.tpl'));
  const workflowScriptTemplate = readText(templatePath('child.workflow-script.json.tpl'));
  const runJsTemplate = readText(templatePath('child.run.js.tpl'));
  const openaiYamlTemplate = readText(templatePath('child.openai.yaml.tpl'));

  // scenarios are nested under metadata: in frontmatter, so indent 4 spaces
  const scenariosSection = spec.trigger_semantics
    .map((phrase) => `    - ${phrase}`)
    .join('\n');

  const skillMd = renderTemplateString(skillMdTemplate, {
    skill_name: spec.skill.name,
    display_name: spec.skill.display_name,
    description: spec.skill.description,
    app_name: getAppName(session),
    target_package: spec.identity.target_package,
    scenarios_section: scenariosSection,
    outcome_section: spec.skill.outcome_section,
    trigger_phrases_section: spec.skill.trigger_phrases_section,
    failure_modes_section: spec.skill.failure_modes_section,
  });

  const businessSpecText = renderTemplateString(businessSpecTemplate, {
    skill_name: spec.business_spec.skillName,
    poll_interval_ms: String(spec.business_spec.runtime.pollIntervalMs),
    timeout_ms: String(spec.business_spec.runtime.timeoutMs),
  });

  const workflowScriptText = renderTemplateString(workflowScriptTemplate, {
    workflow_id: spec.workflow.id,
    display_name: spec.workflow.name,
    description: jsonStringEscape(spec.workflow.description),
    steps_json: JSON.stringify(spec.workflow.steps, null, 2),
    flow_json: JSON.stringify(spec.workflow.flow, null, 2),
    exception_handlers_json: JSON.stringify(spec.workflow.exception_handlers, null, 2),
    timeout_ms: String(spec.workflow.timeout),
  });

  const openaiYamlText = renderTemplateString(openaiYamlTemplate, {
    display_name: spec.skill.display_name,
    short_description: deriveShortDescription(spec.skill.summary || spec.skill.description),
  });

  return {
    spec,
    skillMd,
    businessSpec: spec.business_spec,
    workflowScript: spec.workflow,
    files: {
      'SKILL.md': skillMd,
      'agents/openai.yaml': openaiYamlText,
      'assets/business-spec.json': `${businessSpecText}\n`,
      'assets/workflow-script.json': `${workflowScriptText}\n`,
      'scripts/run.js': runJsTemplate,
    },
  };
}

function writeCompiledArtifacts({ skillDir, session, plan }) {
  const artifacts = buildCompiledArtifacts({ skillDir, session, plan });
  const writtenFiles = [];

  for (const [relativePath, content] of Object.entries(artifacts.files)) {
    const fullPath = path.join(skillDir, relativePath);
    writeText(fullPath, content);
    writtenFiles.push(fullPath);
  }

  return {
    ...artifacts,
    writtenFiles,
  };
}

// Returns the primary semantic field used in a selector, for reporting.
function selectorPrimaryField(selector) {
  if (!selector) return null;
  if (selector.resource_id) {
    return policy.isOpaqueResourceId(selector.resource_id) ? 'resource_id_obfuscated' : 'resource_id';
  }
  if (selector.content_desc) return 'content_desc';
  if (selector.text) return 'text';
  if (selector.center_x !== undefined || selector.center_y !== undefined) return 'coordinate';
  return 'other';
}

// Builds a structured compile-report consumed by quality-reviewer.
// Pre-computes everything that can be checked automatically so the reviewer
// focuses AI judgment only on what requires semantic understanding.
// Text/content_desc values that strongly suggest an interrupt-dismissal action (Q5 signal).
// These are words that typically appear on dialog buttons, permission prompts, or optional banners
// that may or may not appear on every run — i.e., strong handler candidates.
const INTERRUPT_TEXT_PATTERN = /^(ok|okay|allow|deny|skip|dismiss|cancel|not now|accept|agree|no thanks|close|got it|done|later|never|remind me later|continue|proceed|enable|disable|turn on|turn off|yes|no)$/i;

function isInterruptText(value) {
  return typeof value === 'string' && INTERRUPT_TEXT_PATTERN.test(value.trim());
}

// Returns true if the selector's text or content_desc looks like a dialog/permission dismiss action.
// A true result means the reviewer must apply Q5 causality tests — it does NOT mean the step IS a handler.
function detectQ5InterruptSignal(selector) {
  if (!selector) return false;
  return isInterruptText(selector.text) || isInterruptText(selector.content_desc);
}

function buildCompileReport(plan, session) {
  const steps = plan.confirmedSteps || [];

  const perStep = steps.map((step) => {
    const actionSelector = step.confirmed_action?.params?.selector || null;
    const verifySelector = step.verify_selector || null;
    const confirmedActions = step.confirmed_actions || [];

    // Q2: async barrier — side-effecting steps need sleep + arrival verify.
    const hasSleepBarrier = confirmedActions.some((a) => a.path === 'base/sleep');
    const hasArrivalVerify = confirmedActions.some(
      (a) => a.path === 'accessibility/node' && Array.isArray(a.throw_if_empty),
    );

    const actionScore = actionSelector ? policy.selectorProofScore(actionSelector) : null;
    const verifyScore = verifySelector ? policy.selectorProofScore(verifySelector) : null;

    return {
      step_id: step.id,
      intent_type: step.intent_type || null,
      description: step.intent || step.description || null,
      action_selector: actionSelector,
      action_selector_score: actionScore,
      action_selector_field: selectorPrimaryField(actionSelector),
      verify_selector: verifySelector,
      verify_selector_score: verifyScore,
      verify_selector_field: selectorPrimaryField(verifySelector),
      has_sleep_barrier: hasSleepBarrier,
      has_arrival_verify: hasArrivalVerify,
      // Q2 auto-result: only meaningful for steps that side-effect (excludes macro/handler).
      q2_auto: ['launch', 'navigate', 'act', 'seek', 'reveal'].includes(step.intent_type)
        ? (hasSleepBarrier && hasArrivalVerify)
        : null,
      // Q5 pre-screen: action selector matches interrupt-dismissal text pattern.
      // true  → reviewer MUST apply Q5 causality tests (step may need to become a handler).
      // false → step is likely a flow step; skip Q5 unless other evidence suggests otherwise.
      q5_interrupt_signal: detectQ5InterruptSignal(actionSelector),
    };
  });

  // Auto-compute dimensions that don't require semantic understanding.
  const stepsWithAction = perStep.filter((s) => s.action_selector !== null);
  const selectorStability = stepsWithAction.length > 0
    ? Math.round(
      stepsWithAction.filter((s) => s.action_selector_field === 'resource_id' || s.action_selector_field === 'content_desc').length
        / stepsWithAction.length * 100,
    )
    : 100;

  const sideEffectingSteps = perStep.filter((s) =>
    ['launch', 'navigate', 'act', 'seek', 'reveal'].includes(s.intent_type));
  const proofCoverage = sideEffectingSteps.length > 0
    ? Math.round(sideEffectingSteps.filter((s) => s.has_arrival_verify).length / sideEffectingSteps.length * 100)
    : 100;

  const stepsWithVerify = perStep.filter((s) => s.verify_selector !== null);
  const crossDeviceSafety = stepsWithVerify.length > 0
    ? Math.round(stepsWithVerify.filter((s) => s.verify_selector_field !== 'coordinate').length / stepsWithVerify.length * 100)
    : 100;

  // Expose terminal verify selector so device-grader can verify it appears in post-execution dump.
  const terminalStep = perStep[perStep.length - 1];
  const terminalVerifySelector = terminalStep?.verify_selector || null;

  return {
    skill_name: session?.skill_name || '',
    goal_task: session?.goal?.task || null,
    // The terminal step's verify selector — device-grader verifies this appears in post-execution dump.
    terminal_verify_selector: terminalVerifySelector,
    // Checks guaranteed by validateShippabilityPass — reviewer does not need to re-verify.
    auto_verified: {
      q6_schema: 'PASS — compiler rejects throw_if_empty inside params',
      q4_coordinate_verify: 'PASS — compiler rejects coordinate fields in verify_selector',
      q4_obfuscated_action: 'PASS — walk gates reject obfuscated resource_id at record time',
    },
    per_step: perStep,
    // Dimensions the reviewer can trust from pre-computed data.
    auto_dimensions: {
      selector_stability: selectorStability,
      proof_coverage: proofCoverage,
      cross_device_safety: crossDeviceSafety,
    },
    // Dimensions that require AI semantic judgment — reviewer must assess these independently.
    needs_ai_assessment: {
      q1_viewport: 'Is each target guaranteed in viewport, or is there a seek/reveal loop?',
      q3_business_proof: 'Does proof confirm business completion, not just UI change?',
      q5_handler: 'For steps with q5_interrupt_signal=true: apply 3 causality tests (see quality-reviewer.md). For steps with q5_interrupt_signal=false: mark Q5 PASS unless other evidence suggests otherwise.',
      q5_flagged_steps: perStep.filter((s) => s.q5_interrupt_signal).map((s) => s.step_id),
      dimensions: ['handler_coverage', 'target_identity_confidence', 'start_state_tolerance'],
    },
  };
}

module.exports = {
  buildCompilationPlan,
  buildChildSkillSpec,
  buildCompiledArtifacts,
  writeCompiledArtifacts,
  buildCompileReport,
};
