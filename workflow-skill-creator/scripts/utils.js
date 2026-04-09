#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const semanticPolicy = require('./semantic_policy');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const [flag, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      args[flag] = inlineValue;
      continue;
    }

    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      args[flag] = true;
      continue;
    }

    args[flag] = nextToken;
    index += 1;
  }
  return args;
}

function parseSkillMd(skillDir) {
  const content = readText(path.join(skillDir, 'SKILL.md'));
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') {
    throw new Error('SKILL.md missing frontmatter');
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('SKILL.md missing closing frontmatter marker');
  }

  const frontmatter = lines.slice(1, endIndex);
  let name = '';
  let description = '';

  for (let index = 0; index < frontmatter.length; index += 1) {
    const line = frontmatter[index];
    if (line.startsWith('name:')) {
      name = line.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (line.startsWith('description:')) {
      const value = line.slice('description:'.length).trim();
      if (value === '|' || value === '>' || value === '|-' || value === '>-') {
        const descriptionLines = [];
        for (let inner = index + 1; inner < frontmatter.length; inner += 1) {
          if (!/^\s+/.test(frontmatter[inner])) {
            break;
          }
          descriptionLines.push(frontmatter[inner].trim());
        }
        description = descriptionLines.join(' ');
      } else {
        description = value.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  const body = lines.slice(endIndex + 1).join('\n').trim();

  return { name, description, body };
}

function isValidSkillName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length < 64
    && /^[a-z0-9-]+$/.test(name);
}

function validateSkillFrontmatter(parsed, { label = 'SKILL.md' } = {}) {
  const issues = [];

  if (!parsed?.name) {
    issues.push(`${label} frontmatter is missing name`);
  } else if (!isValidSkillName(parsed.name)) {
    issues.push(`${label} name must use lowercase letters, digits, and hyphens only, under 64 characters`);
  }

  if (!parsed?.description) {
    issues.push(`${label} frontmatter is missing description`);
  } else {
    if (parsed.description.length > 500) {
      issues.push(`${label} description should stay under 500 characters`);
    }
  }

  return issues;
}

function validateRootSkillDoc(_parsed) {
  return [];
}

function validateRootReferenceDocs(_skillDir) {
  return [];
}

function readQuotedYamlField(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s{2}${escapedKey}:\\s+"([^"\\n]+)"\\s*$`, 'm'));
  return match ? match[1] : '';
}

function validateOpenAiMetadata(filePath, _skillName) {
  const issues = [];

  if (!fs.existsSync(filePath)) {
    return issues;
  }

  const content = readText(filePath);

  if (!/^interface:\s*$/m.test(content)) {
    issues.push('agents/openai.yaml must define a top-level interface block');
  }

  const displayName = readQuotedYamlField(content, 'display_name');
  const shortDescription = readQuotedYamlField(content, 'short_description');

  if (!displayName) {
    issues.push('agents/openai.yaml interface.display_name must be a quoted string');
  }

  if (!shortDescription) {
    issues.push('agents/openai.yaml interface.short_description must be a quoted string');
  } else if (shortDescription.length < 25 || shortDescription.length > 64) {
    issues.push('agents/openai.yaml interface.short_description must stay between 25 and 64 characters');
  }

  return issues;
}

function validateChildSkillDoc(parsed) {
  const issues = [];
  if (!parsed) return issues;

  const body = parsed.body || '';
  const requiredSections = ['Outcome', 'Trigger Phrases', 'Runtime Contract'];
  for (const section of requiredSections) {
    if (!body.includes(`## ${section}`)) {
      issues.push(`child SKILL.md is missing required section: ## ${section}`);
    }
  }

  return issues;
}

function renderTemplateString(template, variables) {
  return String(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : '';
  });
}

// Escape a string for safe embedding inside a JSON string value.
// Use this instead of the manual JSON.stringify(val).slice(1, -1) pattern.
function jsonStringEscape(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

function resolveWorkspacePath(skillDir) {
  const { name } = parseSkillMd(skillDir);
  const workspaceName = `${name || path.basename(skillDir)}-workspace`;
  return path.join(path.dirname(skillDir), workspaceName);
}

function nextIterationNumber(workspaceRoot) {
  if (!fs.existsSync(workspaceRoot)) {
    return 1;
  }

  const numbers = fs.readdirSync(workspaceRoot)
    .filter((entry) => /^iteration-\d+$/.test(entry))
    .map((entry) => Number(entry.split('-')[1]))
    .filter((value) => Number.isFinite(value));

  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeRetryPolicy(retryPolicy) {
  if (!retryPolicy) {
    return null;
  }
  const loop = {};
  // count and max_count are mutually exclusive (engine-runtime.md § LoopConfig).
  // If both are present, prefer max_count (bounded search) over count (fixed repeat).
  if (retryPolicy.max_count !== undefined) {
    loop.max_count = retryPolicy.max_count;
  } else if (retryPolicy.count !== undefined) {
    loop.count = retryPolicy.count;
  }
  const interval = retryPolicy.interval !== undefined ? retryPolicy.interval : retryPolicy.interval_ms;
  if (interval !== undefined) {
    loop.interval = interval;
  }
  return Object.keys(loop).length > 0 ? loop : null;
}

const DEVICE_DEPENDENT_TEXT_PATTERNS = Object.freeze([
  /\b\d+\b/,
  /\b\d+\s*(items?|apps?|messages?|followers?|following|photos?|videos?|mins?|minutes?|hours?|days?|files?)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
  /%/,
  /@/,
  /https?:\/\//i,
]);

function isLikelyDeviceDependentText(text) {
  if (typeof text !== 'string') {
    return false;
  }
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return DEVICE_DEPENDENT_TEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildStructuralIssue(message, details = {}) {
  return semanticPolicy.buildPolicyIssue(
    semanticPolicy.POLICY_ISSUE_CODES.EVIDENCE_INSUFFICIENT,
    message,
    details
  );
}

const EXCEPTION_HANDLER_TRANSPORT_KEYS = Object.freeze([
  'selector',
  'action',
  'wait_timeout',
  'wait_interval',
  'throw_if_empty',
]);

// Known valid action paths from action-registry.md.
const KNOWN_ACTION_PATHS = new Set([
  'input/click',
  'input/text',
  'input/scroll_bezier',
  'input/keyevent',
  'accessibility/node',
  'accessibility/dump',
  'activity/launch_app',
  'base/sleep',
  'system/shell',
]);

// Coordinate fields that must not appear in verify/proof selectors.
const COORDINATE_SELECTOR_FIELDS = new Set([
  'center_x', 'center_y', 'bounds', 'x', 'y',
]);

function hasSelectorCoordinateFields(selector) {
  if (!selector || typeof selector !== 'object') return false;
  return Object.keys(selector).some((key) => COORDINATE_SELECTOR_FIELDS.has(key));
}

function collectSelectorSafetyIssues(stepId, selector) {
  const issues = [];
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return issues;
  }

  if (hasSelectorCoordinateFields(selector)) {
    issues.push(buildStructuralIssue(
      `step ${stepId} selector must not contain coordinate fields (center_x, center_y, bounds, x, y); use semantic fields only`,
      { step_id: stepId }
    ));
  }

  if (isLikelyDeviceDependentText(selector.text)) {
    issues.push(buildStructuralIssue(
      `step ${stepId} contains a device-dependent text selector "${selector.text}"; use resource_id, content_desc, or a structural pattern instead`,
      { step_id: stepId }
    ));
  }

  const proofScore = semanticPolicy.selectorProofScore(selector);
  if (proofScore <= 10) {
    issues.push(semanticPolicy.buildPolicyIssue(
      semanticPolicy.POLICY_ISSUE_CODES.WEAK_SHIPPED_SELECTOR,
      `step ${stepId} has a weak selector with proof score ${proofScore}; class_name-only or opaque resource_id selectors must not ship — use resource_id (meaningful), content_desc, or text`,
      { step_id: stepId, proof_score: proofScore }
    ));
  }

  return issues;
}

function collectWorkflowPolicyIssues(payload) {
  const issues = [];

  if (!payload || typeof payload !== 'object') {
    return [buildStructuralIssue('workflow steps/flow are required')];
  }

  if (payload.content !== undefined) {
    issues.push(buildStructuralIssue(
      'workflow-script.json must use the flat canonical shape; the legacy content wrapper is not allowed for new child skills'
    ));
    return issues;
  }

  const steps = payload.steps;
  const flow = payload.flow;

  if (!steps || typeof steps !== 'object' || Array.isArray(steps) || Object.keys(steps).length === 0) {
    issues.push(buildStructuralIssue('workflow steps must be a non-empty object'));
  }

  if (!Array.isArray(flow) || flow.length === 0) {
    issues.push(buildStructuralIssue('workflow flow must be a non-empty array'));
  }

  if (payload.exception_handlers !== undefined) {
    if (!Array.isArray(payload.exception_handlers)) {
      issues.push(buildStructuralIssue('workflow exception_handlers must be an array when present'));
    } else {
      for (const [index, handler] of payload.exception_handlers.entries()) {
        if (!isObjectRecord(handler?.selector)) {
          issues.push(buildStructuralIssue(`exception handler ${index} must define a selector object`, { handler_index: index }));
        }
        if (typeof handler?.action !== 'string' || !handler.action.trim()) {
          issues.push(buildStructuralIssue(`exception handler ${index} must define an action`, { handler_index: index }));
        }
        if (handler?.action_params !== undefined) {
          if (!isObjectRecord(handler.action_params)) {
            issues.push(buildStructuralIssue(`exception handler ${index} action_params must be an object when present`, { handler_index: index }));
          } else if (EXCEPTION_HANDLER_TRANSPORT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(handler.action_params, key))) {
            issues.push(buildStructuralIssue(
              `exception handler ${index} action_params must not include transport-only keys such as selector, action, wait_timeout, wait_interval, or throw_if_empty`,
              { handler_index: index }
            ));
          }
        }
        if (
          handler?.max_trigger_count !== undefined
          && (!Number.isInteger(handler.max_trigger_count) || handler.max_trigger_count <= 0)
        ) {
          issues.push(buildStructuralIssue(`exception handler ${index} max_trigger_count must be a positive integer`, { handler_index: index }));
        }
      }
    }
  }

  if (steps && flow) {
    const seenFlowIds = new Set();
    for (const stepId of flow) {
      if (!Object.prototype.hasOwnProperty.call(steps, stepId)) {
        issues.push(buildStructuralIssue(`flow references missing step: ${stepId}`, { step_id: stepId }));
      }
      if (seenFlowIds.has(stepId)) {
        issues.push(buildStructuralIssue(`flow contains duplicate step reference: ${stepId}`, { step_id: stepId }));
      }
      seenFlowIds.add(stepId);
    }
  }

  if (steps && typeof steps === 'object') {
    for (const [stepId, step] of Object.entries(steps)) {
      if (!Array.isArray(step.actions) || step.actions.length === 0) {
        issues.push(buildStructuralIssue(`step ${stepId} must contain at least one action`, { step_id: stepId }));
        continue;
      }
      for (const action of step.actions) {
        if (!action.path || typeof action.path !== 'string') {
          issues.push(buildStructuralIssue(`step ${stepId} contains an action without a path`, { step_id: stepId }));
          continue;
        }
        if (action.path.startsWith('api/')) {
          issues.push(buildStructuralIssue(`step ${stepId} action path must omit the api/ prefix: ${action.path}`, { step_id: stepId }));
        }
        if (!KNOWN_ACTION_PATHS.has(action.path)) {
          issues.push(buildStructuralIssue(
            `step ${stepId} uses unknown action path "${action.path}"; see action-registry.md for valid paths`,
            { step_id: stepId }
          ));
        }
        // throw_if_empty must be an array of field names, never a boolean.
        if (action.throw_if_empty !== undefined && !Array.isArray(action.throw_if_empty)) {
          issues.push(buildStructuralIssue(
            `step ${stepId} action throw_if_empty must be an array (e.g. ["nodes"]), got ${typeof action.throw_if_empty}`,
            { step_id: stepId }
          ));
        }
        // Proof-score check applies to all actions including verify-only ones.
        // verify_selector strength is enforced at walk time so all selectors
        // reaching here are already guaranteed to meet the threshold.
        const isVerifyOnly = semanticPolicy.isNodeVerifyAction(action);
        issues.push(...collectSelectorSafetyIssues(stepId, action.params?.selector));
        if (isVerifyOnly) {
          if (!semanticPolicy.hasNodesThrowIfEmpty(action)) {
            issues.push(semanticPolicy.buildPolicyIssue(
              semanticPolicy.POLICY_ISSUE_CODES.MISSING_OBSERVABLE_POSTCONDITION,
              `step ${stepId} verification action must use throw_if_empty: ["nodes"]`,
              { step_id: stepId }
            ));
          }
          const timeout = semanticPolicy.waitTimeout(action);
          if (timeout === null || timeout < semanticPolicy.MIN_VERIFY_WAIT_TIMEOUT_MS) {
            issues.push(buildStructuralIssue(
              `step ${stepId} verification action must use wait_timeout >= ${semanticPolicy.MIN_VERIFY_WAIT_TIMEOUT_MS}`,
              { step_id: stepId }
            ));
          }
        }
      }

      if (semanticPolicy.getIntentType(step) === 'handler') {
        issues.push(semanticPolicy.buildPolicyIssue(
          semanticPolicy.POLICY_ISSUE_CODES.HANDLER_SHOULD_BE_PROMOTED,
          `step ${stepId} is an interruption handler and must move to exception_handlers`,
          { step_id: stepId }
        ));
      }

      const launchIndex = step.actions.findIndex((action) => semanticPolicy.isLaunchAction(action));
      if (launchIndex >= 0) {
        const trailingActions = step.actions.slice(launchIndex + 1);
        const proofIndex = trailingActions.findIndex((action) => semanticPolicy.isArrivalProofAction(action));
        if (proofIndex === -1) {
          issues.push(semanticPolicy.buildPolicyIssue(
            semanticPolicy.POLICY_ISSUE_CODES.MISSING_ARRIVAL_PROOF,
            `launch step ${stepId} must prove arrival with accessibility/node verification`,
            { step_id: stepId }
          ));
        } else {
          const barrierSleeps = trailingActions.slice(0, proofIndex).filter((action) => semanticPolicy.isBarrierSleepAction(action));
          if (barrierSleeps.length === 0) {
            issues.push(semanticPolicy.buildPolicyIssue(
              semanticPolicy.POLICY_ISSUE_CODES.MISSING_ARRIVAL_PROOF,
              `launch step ${stepId} must place base/sleep between activity/launch_app and arrival proof`,
              { step_id: stepId }
            ));
          } else if (!barrierSleeps.some((action) => (semanticPolicy.sleepDuration(action) || 0) >= semanticPolicy.MIN_BARRIER_SLEEP_MS)) {
            issues.push(semanticPolicy.buildPolicyIssue(
              semanticPolicy.POLICY_ISSUE_CODES.MISSING_ARRIVAL_PROOF,
              `launch step ${stepId} must use base/sleep >= ${semanticPolicy.MIN_BARRIER_SLEEP_MS} between activity/launch_app and arrival proof`,
              { step_id: stepId }
            ));
          }
        }
      }

      for (let index = 0; index < step.actions.length; index += 1) {
        const action = step.actions[index];
        if (!semanticPolicy.isSideEffectingAction(action)) {
          continue;
        }

        let cursor = index + 1;
        const barrierSleeps = [];
        while (cursor < step.actions.length && semanticPolicy.isBarrierSleepAction(step.actions[cursor])) {
          barrierSleeps.push(step.actions[cursor]);
          cursor += 1;
        }

        const nextAction = step.actions[cursor];
        if (!nextAction || (!semanticPolicy.isSideEffectingAction(nextAction) && !semanticPolicy.isNodeVerifyAction(nextAction))) {
          continue;
        }

        if (barrierSleeps.length === 0) {
          issues.push(semanticPolicy.buildPolicyIssue(
            semanticPolicy.POLICY_ISSUE_CODES.MISSING_OBSERVABLE_POSTCONDITION,
            `step ${stepId} must place base/sleep between side-effecting actions and subsequent verification or side-effect`,
            { step_id: stepId }
          ));
          continue;
        }

        if (!barrierSleeps.some((sleepAction) => (semanticPolicy.sleepDuration(sleepAction) || 0) >= semanticPolicy.MIN_BARRIER_SLEEP_MS)) {
          issues.push(semanticPolicy.buildPolicyIssue(
            semanticPolicy.POLICY_ISSUE_CODES.MISSING_OBSERVABLE_POSTCONDITION,
            `step ${stepId} must use base/sleep >= ${semanticPolicy.MIN_BARRIER_SLEEP_MS} between side-effecting actions and subsequent verification or side-effect`,
            { step_id: stepId }
          ));
        }
      }

      if (
        step.actions.every((action) => semanticPolicy.isMechanicalOnlyAction(action))
        && !semanticPolicy.hasObservablePostcondition(step)
        // Shipped workflow JSON strips compile-time intent metadata such as
        // intent_type. At ship-time, a fixed-count loop is the remaining
        // runtime signal that the compiler already accepted this as a macro.
        && !semanticPolicy.hasFixedCountLoop(step)
      ) {
        issues.push(semanticPolicy.buildPolicyIssue(
          semanticPolicy.POLICY_ISSUE_CODES.RAW_TRANSCRIPT_NOT_MERGED,
          `step ${stepId} is a pure mechanical step without observable postcondition; merge it into a semantic step or use loop.count for a deliberate macro`,
          { step_id: stepId }
        ));
      }

      // count and max_count have different semantics (fixed repeat vs retry-until-success)
      // and must not coexist in the same step.
      if (step.loop && step.loop.count !== undefined && step.loop.max_count !== undefined) {
        issues.push(buildStructuralIssue(
          `step ${stepId} must not use both loop.count and loop.max_count; use count for fixed repetition or max_count for retry-until-success`,
          { step_id: stepId }
        ));
      }

      if (step.loop?.max_count !== undefined && step.completed !== 'success') {
        issues.push(buildStructuralIssue(
          `step ${stepId} must pair loop.max_count with completed: "success"`,
          { step_id: stepId }
        ));
      }

      if (step.loop?.count !== undefined && step.completed === 'success') {
        issues.push(buildStructuralIssue(
          `step ${stepId} must not use completed: "success" with loop.count`,
          { step_id: stepId }
        ));
      }
    }
  }

  if (
    steps
    && typeof steps === 'object'
    && Array.isArray(flow)
    && flow.length > 0
    && flow.every((stepId) => Object.prototype.hasOwnProperty.call(steps, stepId))
  ) {
    const terminalStepId = flow[flow.length - 1];
    const terminalStep = steps[terminalStepId];

    // Ship-time check: the terminal step must contain a verification action with
    // throw_if_empty to prove the goal was achieved (Gate 2: Goal proof).
    const actions = terminalStep?.actions || [];
    const hasVerifyWithProof = actions.some((action) =>
      action.path === 'accessibility/node'
      && !action.params?.action
      && Array.isArray(action.throw_if_empty)
      && action.throw_if_empty.length > 0
    );
    if (!hasVerifyWithProof) {
      issues.push(semanticPolicy.buildPolicyIssue(
        semanticPolicy.POLICY_ISSUE_CODES.TERMINAL_VERIFY_MISSING,
        `terminal step ${terminalStepId} has no verification action with throw_if_empty — cannot prove goal completion`,
        { step_id: terminalStepId }
      ));
    }
  }

  return issues;
}

function validateWorkflowPayload(payload) {
  return collectWorkflowPolicyIssues(payload).map((issue) => issue.message);
}

function normalizeResponse(response, payload) {
  const normalized = {
    ok: response.ok,
    httpStatus: response.status,
    data: payload,
    error: null,
    raw: payload
  };

  if (payload && typeof payload === 'object') {
    // SDK envelope: { request_id, code, msg, data, cost } — check first
    if (Object.prototype.hasOwnProperty.call(payload, 'code')) {
      const code = Number(payload.code);
      normalized.ok = response.ok && (code === 0 || code === 200);
      normalized.data = payload.data !== undefined ? payload.data : payload;
      normalized.error = normalized.ok ? null : (payload.msg || payload.message || payload.error || `HTTP ${response.status}`);
      return normalized;
    }

    // Fallback: { success, data } pattern (e.g. workflow/cancel inner result)
    if (Object.prototype.hasOwnProperty.call(payload, 'success')) {
      normalized.ok = response.ok && Boolean(payload.success);
      normalized.data = payload.data !== undefined ? payload.data : payload;
      normalized.error = normalized.ok ? null : (payload.msg || payload.message || payload.error || `HTTP ${response.status}`);
      return normalized;
    }

    if (payload.data !== undefined) {
      normalized.data = payload.data;
    }

    if (payload.error || payload.message) {
      normalized.ok = false;
      normalized.error = payload.error || payload.message;
    }
  }

  if (!normalized.ok && !normalized.error) {
    normalized.error = `HTTP ${response.status}`;
  }

  return normalized;
}

async function postJson(baseUrl, apiPath, body) {
  const target = `${String(baseUrl).replace(/\/$/, '')}/${String(apiPath).replace(/^\//, '')}`;
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { rawText: text };
  }
  return normalizeResponse(response, payload);
}

function getValueAtPath(source, pathExpression) {
  if (!pathExpression) {
    return source;
  }
  const normalized = pathExpression.replace(/\[(\d+)\]/g, '.$1');
  const tokens = normalized.split('.').filter(Boolean);
  let current = source;
  for (const token of tokens) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

function stringifyExpectation(expectation) {
  if (typeof expectation === 'string') {
    return expectation;
  }
  return JSON.stringify(expectation);
}

function gradeRun({ expectations, result, transcript, timing, notes }) {
  const resultText = JSON.stringify(result, null, 2);
  const graded = [];

  for (const expectation of expectations || []) {
    if (typeof expectation === 'string') {
      const passed = transcript.includes(expectation) || resultText.includes(expectation);
      graded.push({
        text: expectation,
        passed,
        evidence: passed ? 'Matched the transcript or result payload text' : 'Did not find the expectation text in transcript or result payload'
      });
      continue;
    }

    const type = expectation.type;
    const text = expectation.text || stringifyExpectation(expectation);
    let passed = false;
    let evidence = 'Expectation type not implemented';

    if (type === 'success') {
      passed = Boolean(result?.success) === (expectation.equals !== false);
      evidence = `result.success was ${JSON.stringify(result?.success)}`;
    } else if (type === 'workflow_status') {
      const actual = getValueAtPath(result, expectation.path || 'execution.status');
      passed = actual === expectation.equals;
      evidence = `${expectation.path || 'execution.status'} was ${JSON.stringify(actual)}`;
    } else if (type === 'json_path_exists') {
      const actual = getValueAtPath(result, expectation.path);
      passed = actual !== undefined;
      evidence = `${expectation.path} ${passed ? 'exists' : 'is missing'}`;
    } else if (type === 'json_path_equals') {
      const actual = getValueAtPath(result, expectation.path);
      passed = JSON.stringify(actual) === JSON.stringify(expectation.equals);
      evidence = `${expectation.path} was ${JSON.stringify(actual)}`;
    } else if (type === 'record_count_gte') {
      const actual = getValueAtPath(result, expectation.path || 'execution.records');
      const length = Array.isArray(actual) ? actual.length : 0;
      passed = length >= Number(expectation.min || 0);
      evidence = `${expectation.path || 'execution.records'} length was ${length}`;
    } else if (type === 'step_succeeds') {
      const records = getValueAtPath(result, expectation.path || 'execution.records') || [];
      const matched = Array.isArray(records)
        ? records.find((record) => record.stepId === expectation.step_id || record.step_id === expectation.step_id)
        : null;
      passed = Boolean(matched && matched.succeed === true);
      evidence = matched ? `step ${expectation.step_id} succeed=${JSON.stringify(matched.succeed)}` : `step ${expectation.step_id} not found`;
    } else if (type === 'contains_text') {
      const haystack = expectation.path ? JSON.stringify(getValueAtPath(result, expectation.path)) : `${transcript}\n${resultText}`;
      passed = haystack.includes(String(expectation.value || ''));
      evidence = passed ? `Found ${JSON.stringify(expectation.value)} in ${expectation.path || 'transcript/result'}` : `Did not find ${JSON.stringify(expectation.value)}`;
    }

    graded.push({ text, passed, evidence });
  }

  const passedCount = graded.filter((item) => item.passed).length;
  const total = graded.length;
  const failed = total - passedCount;
  const passRate = total === 0 ? 0 : passedCount / total;
  const records = getValueAtPath(result, 'execution.records');

  return {
    expectations: graded,
    summary: {
      passed: passedCount,
      failed,
      total,
      pass_rate: Number(passRate.toFixed(4))
    },
    execution_metrics: {
      total_tool_calls: 0,
      total_steps: Array.isArray(records) ? records.length : 0,
      errors_encountered: result?.success ? 0 : 1,
      output_chars: resultText.length,
      transcript_chars: transcript.length
    },
    timing: timing || {},
    claims: result?.execution?.status ? [
      {
        claim: `workflow finished with status ${result.execution.status}`,
        type: 'factual',
        verified: true,
        evidence: `execution.status was ${result.execution.status}`
      }
    ] : [],
    user_notes_summary: {
      uncertainties: [],
      needs_review: [],
      workarounds: notes || []
    },
    eval_feedback: {
      suggestions: [],
      overall: 'No automatic eval feedback'
    }
  };
}

function normalizeSelectorForRuntime(selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return selector;
  }

  const normalized = { ...selector };
  if (normalized.class === undefined && normalized.class_name !== undefined) {
    normalized.class = normalized.class_name;
  }
  delete normalized.class_name;
  return normalized;
}

function normalizeThrowIfEmpty(keys) {
  if (!Array.isArray(keys)) {
    return keys;
  }

  const normalized = [];
  for (const key of keys) {
    if (!normalized.includes(key)) {
      normalized.push(key);
    }
  }
  return normalized;
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function normalizeRuntimePayload(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRuntimePayload(item, parentKey));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (parentKey === 'selector') {
    return normalizeSelectorForRuntime(value);
  }

  if (parentKey === 'throw_if_empty') {
    return normalizeThrowIfEmpty(value);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const snakeKey = camelToSnake(key);
      return [snakeKey, normalizeRuntimePayload(child, snakeKey)];
    })
  );
}

module.exports = {
  clone,
  ensureDir,
  gradeRun,
  nextIterationNumber,
  collectWorkflowPolicyIssues,
  normalizeRetryPolicy,
  normalizeRuntimePayload,
  normalizeSelectorForRuntime,
  normalizeThrowIfEmpty,
  isValidSkillName,
  parseArgs,
  parseSkillMd,
  postJson,
  readJson,
  readText,
  resolveWorkspacePath,
  validateChildSkillDoc,
  validateRootReferenceDocs,
  validateOpenAiMetadata,
  validateRootSkillDoc,
  validateSkillFrontmatter,
  validateWorkflowPayload,
  jsonStringEscape,
  renderTemplateString,
  sleep,
  writeJson,
  writeText
};
