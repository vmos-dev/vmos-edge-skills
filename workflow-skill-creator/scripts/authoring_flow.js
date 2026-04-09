'use strict';

const { DEFAULT_SETTLE_DELAYS_MS, classifyActionKind } = require('./reliability_policy');
const { sampleUntilSettled } = require('./settle_detector');
const { snapshotsEqual } = require('./page_snapshot');
const { selectorKey, selectorProofScore, isAgentRelevant, computeRelevanceThreshold, isOpaqueResourceId } = require('./semantic_policy');
const { normalizeRetryPolicy } = require('./utils');
const { annotateDump } = require('./observation_formatter');
const { resolveAction } = require('./action_resolver');

function parseAction(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {
    throw new Error(`Invalid --action JSON: ${e.message}`);
  }
}

function parseOptionalJsonArg(raw, flagName) {
  if (raw === undefined) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid --${flagName} JSON: ${error.message}`);
  }
}

function parseOptionalBooleanArg(raw, flagName) {
  if (raw === undefined) {
    return null;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid --${flagName} boolean: ${raw}`);
}

function readSemanticHints(args) {
  return {
    step_key: args['step-key'] || null,
    intent_type: args['intent-type'] || null,
    success_condition: parseOptionalJsonArg(args['success-condition'], 'success-condition'),
    retry_policy: parseOptionalJsonArg(args['retry-policy'], 'retry-policy'),
    // verify_selector is set via the confirm command after walk, not during walk.
    postcondition_page_id: args['postcondition-page-id'] || null,
    throw_if_empty: parseOptionalJsonArg(args['throw-if-empty'], 'throw-if-empty'),
    loop: parseOptionalJsonArg(args.loop, 'loop'),
    is_verify_step: parseOptionalBooleanArg(args['is-verify-step'], 'is-verify-step') || false,
  };
}

/**
 * Derive a semantic step key from structured step data.
 * Priority: intent_type + action target (from selector/package) → description fallback.
 * Produces keys like: launch_settings, navigate_about_phone, seek_android_version
 */
function deriveStepKey(description, seq, stepData) {
  const intent = stepData?.intent_type;
  const action = stepData?.action;
  const verify = stepData?.verify_selector;

  // Try to build from intent + target
  const target = extractTarget(action, verify);
  if (intent && target) {
    return sanitizeKey(`${intent}_${target}`);
  }
  if (intent) {
    return sanitizeKey(`${intent}_step_${seq}`);
  }

  // Fallback: description string cleaning
  if (description) {
    return sanitizeKey(description);
  }
  return `step_${seq}`;
}

function extractTarget(action, verify) {
  // Package name for launch
  const pkg = action?.params?.package_name;
  if (pkg) {
    const appName = pkg.split('.').pop(); // com.android.settings → settings
    return appName;
  }

  // Selector text/content_desc for click targets
  const sel = action?.params?.selector;
  const label = sel?.text || sel?.content_desc || verify?.text || verify?.content_desc;
  if (label) {
    // Extract ASCII-friendly portion, or transliterate common patterns
    const ascii = label.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (ascii.length >= 3) return ascii;
    // For non-ASCII labels (Chinese etc), use verify if different
    const verifyLabel = verify?.text || verify?.content_desc;
    if (verifyLabel) {
      const verifyAscii = verifyLabel.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      if (verifyAscii.length >= 3) return verifyAscii;
    }
  }

  return null;
}

function sanitizeKey(raw) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || null;
}

function pageSummary(snapshot, filePath) {
  return {
    package: snapshot?.package_name || null,
    activity: snapshot?.top_activity?.activity || snapshot?.top_activity || null,
    key_nodes_count: Array.isArray(snapshot?.key_nodes) ? snapshot.key_nodes.length : 0,
    file: filePath,
  };
}

function sameSnapshot(a, b) {
  return snapshotsEqual(a, b);
}

async function defaultCapturePage(baseUrl) {
  const deviceApi = require('./device_api');
  const pageSnapshot = require('./page_snapshot');
  return defaultCapturePageWithDeps(baseUrl, { deviceApi, pageSnapshot });
}

async function defaultCapturePageWithDeps(baseUrl, { deviceApi, pageSnapshot }) {
  const dump = await deviceApi.dump(baseUrl);
  let topActivity = null;
  try {
    topActivity = await deviceApi.topActivity(baseUrl);
  } catch (_) {}

  return {
    dump,
    topActivity,
    snapshot: pageSnapshot.normalizeSnapshot({
      packageName: topActivity?.package_name || null,
      topActivity,
      dump,
    }),
  };
}

function deriveCandidateIntentType({ actionKind, before, after, pageChanged }) {
  if (actionKind === 'launch') {
    return 'navigate';
  }
  if (actionKind === 'node_click' && pageChanged && !sameSnapshot(before, after)) {
    return 'navigate';
  }
  if (actionKind === 'scroll') {
    return 'seek';
  }
  if (actionKind === 'node_query') {
    return 'verify';
  }
  return null;
}

function deriveVerifySelector(step) {
  if (step.verify_selector) {
    return step.verify_selector;
  }
  if (step.success_condition?.selector) {
    return step.success_condition.selector;
  }
  return null;
}

function derivePostconditionPageId(step) {
  if (step.postcondition_page_id) {
    return step.postcondition_page_id;
  }
  if (step.success_condition?.page_id) {
    return step.success_condition.page_id;
  }
  return null;
}

function deriveThrowIfEmpty(step) {
  if (step.throw_if_empty) {
    return step.throw_if_empty;
  }
  if (step.success_condition?.throw_if_empty) {
    return step.success_condition.throw_if_empty;
  }
  return null;
}

function deriveLoop(step) {
  return normalizeRetryPolicy(step.loop) || normalizeRetryPolicy(step.retry_policy) || null;
}

async function capturePageOrThrow(capturePage, label) {
  try {
    return await capturePage();
  } catch (error) {
    throw new Error(`Failed to capture ${label}: ${error.message}`);
  }
}

function deriveVerifyFlag(step) {
  if (step.is_verify_step) {
    return true;
  }
  return Boolean(step.loop || step.retry_policy);
}

function buildGoal(session) {
  return {
    task: session.task,
    target_package: session.app,
  };
}

function buildObservedSelectors(step) {
  const selectors = [];
  const seen = new Set();

  function add(selector) {
    if (!selector) return;
    const key = selectorKey(selector);
    if (seen.has(key)) return;
    seen.add(key);
    selectors.push(selector);
  }

  add(step.verify_selector || null);
  add(step.success_condition?.selector || null);
  add(deriveVerifySelector(step));

  return selectors;
}

function buildLockedEvidence(step) {
  return {
    confirmed_action: step.action,
    before_page: step.before_page || null,
    after_page: step.after_page || null,
    success: step.success !== undefined ? step.success : true,
    evidence: step.evidence || {},
    observed_selectors: buildObservedSelectors(step),
  };
}

function buildCompilerHints(step) {
  const verifyCandidates = buildObservedSelectors(step);
  return {
    intent_type: step.intent_type || step.evidence?.candidate_intent_type || null,
    success_condition: step.success_condition || null,
    retry_policy: step.retry_policy || null,
    verify_candidates: verifyCandidates,
    loop_hint: deriveLoop(step),
    throw_if_empty_hint: deriveThrowIfEmpty(step),
    verify_step_hint: deriveVerifyFlag(step),
  };
}

function nodeToSelector(node) {
  if (node.content_desc) return { content_desc: node.content_desc };
  if (node.text) return { text: node.text };
  if (node.resource_id) return { resource_id: node.resource_id };
  return null;
}

function nodeKey(node) {
  return JSON.stringify(nodeToSelector(node));
}

// --- Page diff (internal, used by formatWalkResult) ---

function computePageDiff(before, after) {
  if (!before || !after) return null;

  const beforeSet = new Set((before.key_nodes || []).map(nodeKey).filter(Boolean));
  const afterSet = new Set((after.key_nodes || []).map(nodeKey).filter(Boolean));

  const newElements = (after.key_nodes || [])
    .filter(n => !beforeSet.has(nodeKey(n)))
    .map(nodeToSelector)
    .filter(Boolean)
    .slice(0, 10);

  const removedElements = (before.key_nodes || [])
    .filter(n => !afterSet.has(nodeKey(n)))
    .map(nodeToSelector)
    .filter(Boolean)
    .slice(0, 10);

  return { beforeSet, afterSet, newElements, removedElements };
}

// --- Agent-facing output formatting ---
// Walk internals handle recording + persistence.
// This function transforms internal data into the compact format code agents consume.

function formatWalkResult({ stepSeq, success, verifyStatus, before, after, pageChanged, dir }) {
  const diff = computePageDiff(before, after);
  if (!diff) {
    return {
      step: stepSeq, success, verify_status: verifyStatus,
      page_changed: pageChanged,
      activity: after?.top_activity || null,
      diff: [], recommended_verify: null,
      next: verifyStatus === 'pending'
        ? 'No page diff available. Check the after dump file for elements.'
        : 'Verify selector already set.',
    };
  }

  const { beforeSet, newElements, removedElements } = diff;

  // Compute adaptive threshold from after-page elements.
  // Text-rich pages → only mark text/content_desc. Icon-heavy pages → also mark resource_ids.
  const afterSelectors = (after.key_nodes || []).map(nodeToSelector).filter(Boolean);
  const threshold = computeRelevanceThreshold(afterSelectors);

  // Build unified diff using the adaptive threshold
  const annotated = [];
  for (const node of (after.key_nodes || []).slice(0, 15)) {
    const sel = nodeToSelector(node);
    if (!sel) continue;
    const isNew = !beforeSet.has(nodeKey(node));
    const score = selectorProofScore(sel);
    const relevant = isAgentRelevant(sel, threshold);
    if (isNew && relevant) {
      annotated.push({ s: '+', selector: sel, score });
    } else if (relevant) {
      annotated.push({ s: ' ', selector: sel, score });
    }
  }
  for (const sel of removedElements.slice(0, 5)) {
    if (isAgentRelevant(sel, threshold)) {
      annotated.push({ s: '-', selector: sel });
    }
  }

  // Top candidate: highest-scoring new element
  const candidates = annotated
    .filter(e => e.s === '+')
    .sort((a, b) => b.score - a.score);
  const top = candidates[0] || null;

  const needsVerify = verifyStatus === 'pending';
  let next;
  if (!needsVerify) {
    next = 'Verify selector already set.';
  } else if (top) {
    const selJson = JSON.stringify(top.selector);
    next = `confirm --dir ${dir} --step ${stepSeq} --verify '${selJson}'`;
  } else {
    next = 'No strong verify candidates. Check after dump for suitable elements, or re-record this step.';
  }

  return {
    step: stepSeq,
    success,
    verify_status: verifyStatus,
    page_changed: pageChanged,
    activity: after?.top_activity || null,
    diff: annotated,
    recommended_verify: top ? top.selector : null,
    next,
  };
}

// Intents that need verify_selector (via walk --verify-selector or confirm command).
const VERIFY_REQUIRED_INTENTS = new Set(['launch', 'navigate', 'act']);

function validateWalkInputs(action, hints) {
  const selector = action?.params?.selector || null;

  // 1. Reject obfuscated resource_id
  if (selector && selector.resource_id && isOpaqueResourceId(selector.resource_id)) {
    throw new Error(`Selector resource_id "${selector.resource_id}" appears obfuscated (short/numeric). Use a meaningful id.`);
  }

  // 2. Launch intent must use activity/launch_app, not click on icon.
  if (hints?.intent_type === 'launch' && action?.path !== 'activity/launch_app') {
    throw new Error(
      'Launch intent requires action path "activity/launch_app" with package_name. ' +
      'Do not click desktop icons — icon positions vary across devices.'
    );
  }

  // 3. Reject weak action selectors — cross-device stability requires text, content_desc, or meaningful resource_id.
  if (selector) {
    const score = selectorProofScore(selector);
    if (score <= 10) {
      throw new Error(
        `Action selector is too weak (score ${score}). ` +
        `Use text, content_desc, or a meaningful resource_id.\n` +
        `Weak selector: ${JSON.stringify(selector)}\n` +
        `Use snapshot to inspect available elements and choose a stronger selector.`
      );
    }
  }

  // 3. Set verify_status based on intent type.
  // Intents in VERIFY_REQUIRED_INTENTS (launch, navigate, act) need explicit confirm.
  // All others (seek, reveal, verify, macro, handler) are auto-confirmed — their
  // verify-selector is optional per recording contract.
  const intentType = hints?.intent_type || null;
  if (intentType && VERIFY_REQUIRED_INTENTS.has(intentType)) {
    hints.verify_status = 'pending';    // use confirm command after reviewing changes
  } else if (intentType) {
    hints.verify_status = 'confirmed';  // optional-verify intents are auto-confirmed
  }
}

async function walk(args, deps = {}) {
  const workspace = deps.workspace || require('./authoring_workspace');
  const dir = args.dir;
  if (!dir) throw new Error('walk requires --dir');

  // delete-step shortcut
  if (args['delete-step']) {
    const seq = Number(args['delete-step']);
    workspace.deleteStep(dir, seq);
    return { deleted: true, step_seq: seq };
  }

  // Resolve action from args via the unified action resolver.
  // All shortcuts (--selector, --scroll, --key, --launch, --input) are handled there.
  let deviceContext = {};
  if (args.scroll) {
    const deviceApi = deps.deviceApi || require('./device_api');
    const session = workspace.loadSession(dir);
    try {
      const info = await deviceApi.displayInfo(session.base_url);
      deviceContext = { screenWidth: info?.width, screenHeight: info?.height };
    } catch (_) { /* use defaults */ }
  }
  const resolved = resolveAction(args, deviceContext);
  const action = resolved?.action;
  if (!action || !action.path) throw new Error('walk requires --action, --selector, --scroll, --key, or --launch');

  const hints = readSemanticHints(args);

  // Enforce recording quality gate before any device interaction.
  validateWalkInputs(action, hints);

  // Enforce intent-type is always provided.
  if (!hints.intent_type) {
    throw new Error(
      'Walk rejected: --intent-type is required for every step. ' +
      'Valid values: launch, navigate, seek, reveal, act, verify, macro, handler.'
    );
  }

  const description = args.description || args.action;
  const session = workspace.loadSession(dir);
  const baseUrl = session.base_url;

  // Validate step targets before executing any device action.
  if (args['fix-step']) {
    const seq = Number(args['fix-step']);
    if (!session.steps.some((s) => s.seq === seq)) {
      throw new Error(`--fix-step ${seq}: no step with that sequence number exists`);
    }
  }
  if (args['insert-after']) {
    const afterSeq = Number(args['insert-after']);
    if (afterSeq !== 0 && !session.steps.some((s) => s.seq === afterSeq)) {
      throw new Error(`--insert-after ${afterSeq}: no step with that sequence number exists`);
    }
  }
  const deviceApi = deps.deviceApi || require('./device_api');
  const pageSnapshot = deps.pageSnapshot || require('./page_snapshot');

  const capturePage = deps.capturePage || (deps.snapshot
    ? async () => ({
      snapshot: await deps.snapshot(),
      dump: null,
      topActivity: null,
    })
    : async () => defaultCapturePageWithDeps(baseUrl, { deviceApi, pageSnapshot }));

  const execute = deps.execute || (async (act) => {
    return deviceApi.runWorkflowStep(baseUrl, { actions: [act], description });
  });
  const beforeCapture = await capturePageOrThrow(capturePage, 'before-action page');
  const before = beforeCapture.snapshot;

  // Generate unique file prefix.  Normal walks use the next step number.
  // fix-step uses the target step's seq + fix index so it never collides
  // with files that a later step will write (the original naming bug).
  let filePrefix;
  if (args['fix-step']) {
    const fixSeq = Number(args['fix-step']);
    const existingStep = session.steps.find((s) => s.seq === fixSeq);
    const fixIndex = (existingStep?.fix_history?.length || 0) + 1;
    filePrefix = `step${fixSeq}_fix${fixIndex}`;
  } else {
    filePrefix = `step${session.steps.length + 1}`;
  }
  const beforeFile = `${filePrefix}_before.json`;
  const beforeDumpFile = `${filePrefix}_before.dump.txt`;
  workspace.savePageSnapshot(dir, beforeFile, before);
  const beforeDumpCompact = await deviceApi.dumpCompact(baseUrl);
  workspace.saveDumpSnapshot(dir, beforeDumpFile, beforeDumpCompact);

  // execute action
  const stepResult = await execute(action);
  const executeFailed = stepResult?.succeed === false || stepResult?.success === false;

  // snapshot after (with wait strategy)
  const waitDelays = deps.waitDelays || DEFAULT_SETTLE_DELAYS_MS;
  const sleepFn = deps.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const settleResult = await sampleUntilSettled({
    initialSnapshot: beforeCapture,
    sampleSnapshot: () => capturePageOrThrow(capturePage, 'post-action page'),
    waitDelaysMs: waitDelays,
    snapshotsEqual: (left, right) => sameSnapshot(left?.snapshot, right?.snapshot),
    sleepFn,
  });
  const afterCapture = settleResult.finalSnapshot || beforeCapture;
  const after = afterCapture.snapshot;
  const pageChanged = settleResult.pageChanged;
  const afterFile = `${filePrefix}_after.json`;
  const afterDumpFile = `${filePrefix}_after.dump.txt`;
  workspace.savePageSnapshot(dir, afterFile, after);
  const afterDumpRaw = await deviceApi.dumpCompact(baseUrl);
  // Save annotated after-dump: diff markers (+/-) and scores for agent readability
  const annotatedAfterDump = annotateDump(afterDumpRaw, beforeDumpCompact, {
    beforeActivity: before?.top_activity || null,
    afterActivity: after?.top_activity || null,
  });
  workspace.saveDumpSnapshot(dir, afterDumpFile, annotatedAfterDump);

  const success = !executeFailed;
  const evidence = {
    wait_delays_ms: [...waitDelays],
    observed_settle_ms: settleResult.settledAfterMs,
    sample_window_ms: settleResult.sampleWindowMs,
    page_changed: pageChanged,
    page_stable: settleResult.pageStable,
    action_kind: classifyActionKind(action),
    candidate_intent_type: deriveCandidateIntentType({
      actionKind: classifyActionKind(action),
      before,
      after,
      pageChanged,
    }),
  };
  const semanticHints = hints;

  // as-handler: record as exception handler, not as step
  if (args['as-handler']) {
    workspace.addHandler(dir, {
      name: args['as-handler'],
      description,
      action,
    });
    const handlerResult = formatWalkResult({
      stepSeq: 0, success, verifyStatus: 'confirmed',
      before, after, pageChanged, dir,
    });
    handlerResult.handler = args['as-handler'];
    return handlerResult;
  }

  // record step
  const stepData = {
    description,
    action,
    before_page: `pages/${beforeFile}`,
    after_page: `pages/${afterFile}`,
    success,
    evidence,
    ...semanticHints,
  };

  let resultSession;
  let stepSeq;

  if (args['fix-step']) {
    stepSeq = Number(args['fix-step']);
    resultSession = workspace.fixStep(dir, stepSeq, stepData);
  } else if (args['insert-after']) {
    const afterSeq = Number(args['insert-after']);
    resultSession = workspace.insertStep(dir, afterSeq, stepData);
    stepSeq = afterSeq + 1;
  } else {
    resultSession = workspace.recordWalk(dir, stepData);
    stepSeq = resultSession.steps[resultSession.steps.length - 1].seq;
  }

  return formatWalkResult({
    stepSeq,
    success,
    verifyStatus: semanticHints.verify_status || 'pending',
    before,
    after,
    pageChanged,
    dir,
  });
}

function buildCompilerView(session) {
  // Ensure unique step ids — append _N suffix on collision.
  const usedIds = new Set();
  function uniqueStepId(raw) {
    let id = raw;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${raw}_${n}`)) n++;
      id = `${raw}_${n}`;
    }
    usedIds.add(id);
    return id;
  }

  return {
    skill_name: session.skill_name,
    app: session.app,
    app_name: session.app_name,
    task: session.task,
    base_url: session.base_url,
    goal: buildGoal(session),
    steps: session.steps.map(s => ({
      id: uniqueStepId(s.step_key || deriveStepKey(s.description, s.seq, s)),
      intent: s.description,
      locked_evidence: buildLockedEvidence(s),
      compiler_hints: buildCompilerHints(s),
    })),
    recoveries: (session.handlers || []).map(h => ({
      id: `handler_${h.name}`,
      trigger: h.description,
      selector: h.action?.params?.selector || {},
      action: h.action?.path?.includes('click') ? 'click' : 'dismiss',
      action_params: h.action?.params || {},
      contexts: [],
      status: 'confirmed',
      max_trigger_count: 3,
    })),
  };
}

module.exports = { walk, buildCompilerView, validateWalkInputs };
