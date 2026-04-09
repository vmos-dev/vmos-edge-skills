'use strict';

const fs = require('fs');
const path = require('path');
const {
  ensureDir,
  readJson,
  writeJson,
} = require('./utils');

function sessionPath(skillDir) {
  return path.join(skillDir, 'authoring', 'session.json');
}

function pagesDir(skillDir) {
  return path.join(skillDir, 'authoring', 'pages');
}

function dumpsDir(skillDir) {
  return path.join(skillDir, 'authoring', 'dumps');
}

function initWorkspace(skillDir, { skillName, task, app, appName, baseUrl } = {}) {
  const authoringDir = path.join(skillDir, 'authoring');
  ensureDir(authoringDir);
  ensureDir(path.join(authoringDir, 'pages'));
  ensureDir(path.join(authoringDir, 'dumps'));

  const session = {
    skill_name: skillName || '',
    task: task || '',
    app: app || '',
    app_name: appName || '',
    base_url: baseUrl || '',
    goal: {
      task: task || '',
      target_package: app || '',
    },
    steps: [],
    handlers: [],
    status: 'authoring',
  };

  return saveSession(skillDir, session);
}

function loadSession(skillDir) {
  return readJson(sessionPath(skillDir));
}

function saveSession(skillDir, session) {
  writeJson(sessionPath(skillDir), session);
  return session;
}

function loadPages(skillDir) {
  const dir = pagesDir(skillDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readJson(path.join(dir, entry)));
}

function savePageSnapshot(skillDir, fileName, snapshot) {
  if (!fileName) {
    throw new Error('savePageSnapshot requires fileName');
  }
  const payload = JSON.parse(JSON.stringify(snapshot));
  writeJson(path.join(pagesDir(skillDir), fileName), payload);
  return payload;
}

function saveDumpSnapshot(skillDir, fileName, dump) {
  if (!fileName) {
    throw new Error('saveDumpSnapshot requires fileName');
  }
  const filePath = path.join(dumpsDir(skillDir), fileName);
  fs.writeFileSync(filePath, String(dump || ''), 'utf8');
  return dump;
}

function loadLatestDump(skillDir, hint) {
  const dir = dumpsDir(skillDir);
  if (!fs.existsSync(dir)) {
    return null;
  }

  const entries = fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.txt'))
    .map((entry) => ({
      entry,
      path: path.join(dir, entry),
      mtimeMs: fs.statSync(path.join(dir, entry)).mtimeMs,
    }));
  const filtered = hint
    ? entries.filter((item) => item.entry.includes(hint))
    : entries;
  const latest = filtered.sort((left, right) => left.mtimeMs - right.mtimeMs)[filtered.length - 1];
  if (!latest) {
    return null;
  }

  return {
    file_name: latest.entry,
    path: latest.path,
    payload: fs.readFileSync(latest.path, 'utf8'),
  };
}

function nextSeq(steps) {
  if (steps.length === 0) return 1;
  return Math.max(...steps.map((s) => s.seq)) + 1;
}

function renumber(steps) {
  for (let i = 0; i < steps.length; i++) {
    steps[i].seq = i + 1;
  }
}

function recordWalk(skillDir, stepData) {
  const session = loadSession(skillDir);
  const seq = nextSeq(session.steps);
  const step = {
    seq,
    step_key: stepData.step_key || null,
    description: stepData.description || '',
    action: stepData.action || {},
    before_page: stepData.before_page || '',
    after_page: stepData.after_page || '',
    success: stepData.success !== undefined ? stepData.success : true,
    intent_type: stepData.intent_type || null,
    success_condition: stepData.success_condition || null,
    retry_policy: stepData.retry_policy || null,
    merge_policy: stepData.merge_policy || null,
    verify_selector: stepData.verify_selector || null,
    verify_status: stepData.verify_status || (stepData.verify_selector ? 'confirmed' : 'pending'),
    postcondition_page_id: stepData.postcondition_page_id || null,
    throw_if_empty: stepData.throw_if_empty || null,
    loop: stepData.loop || null,
    is_verify_step: stepData.is_verify_step || false,
    evidence: stepData.evidence || null,
    fix_history: [],
  };
  session.steps.push(step);
  return saveSession(skillDir, session);
}

// Step field categories:
//   identity:     seq, step_key — preserved across fixes
//   action:       action, description, before_page, after_page, success, evidence — replaced by fix
//   hints:        intent_type, success_condition, retry_policy, merge_policy, postcondition_page_id,
//                 throw_if_empty, loop, is_verify_step — new values from fix, fall back to old
//   verification: verify_selector, verify_status — reset or preserved depending on fix content
// fixStep merges new data into old step by category, never enumerating fields manually.

function fixStep(skillDir, seq, stepData) {
  const session = loadSession(skillDir);
  const index = session.steps.findIndex((s) => s.seq === seq);
  if (index === -1) {
    throw new Error(`No step with seq ${seq}`);
  }
  const old = session.steps[index];
  const history = [...(old.fix_history || []), {
    description: old.description,
    action: old.action,
    before_page: old.before_page,
    after_page: old.after_page,
    success: old.success,
    evidence: old.evidence,
  }];

  // Merge: start from old step (preserves all fields including step_key),
  // overlay new data, then set fix-specific fields.
  session.steps[index] = {
    ...old,             // preserve everything (identity + hints + verification)
    ...stepData,        // overlay new action + hints from walk
    seq,                // identity: always keep original seq
    step_key: old.step_key,  // identity: never overwrite from stepData
    verify_status: stepData.verify_status || (stepData.verify_selector ? 'confirmed' : (old.verify_status || 'pending')),
    fix_history: history,
  };

  // Invalidate all steps after the fixed one — their checkpoint (previous step's
  // after-state) has changed, so their verify is no longer trustworthy.
  for (let j = index + 1; j < session.steps.length; j++) {
    if (session.steps[j].verify_status === 'confirmed') {
      session.steps[j].verify_status = 'invalidated';
    }
  }

  return saveSession(skillDir, session);
}

function insertStep(skillDir, afterSeq, stepData) {
  const session = loadSession(skillDir);
  let insertIndex;
  if (afterSeq === 0) {
    insertIndex = 0;
  } else {
    const found = session.steps.findIndex((s) => s.seq === afterSeq);
    if (found === -1) {
      throw new Error(`No step with seq ${afterSeq}`);
    }
    insertIndex = found + 1;
  }
  const step = {
    seq: 0,
    description: stepData.description || '',
    action: stepData.action || {},
    before_page: stepData.before_page || '',
    after_page: stepData.after_page || '',
    success: stepData.success !== undefined ? stepData.success : true,
    intent_type: stepData.intent_type || null,
    success_condition: stepData.success_condition || null,
    retry_policy: stepData.retry_policy || null,
    merge_policy: stepData.merge_policy || null,
    verify_selector: stepData.verify_selector || null,
    verify_status: stepData.verify_status || (stepData.verify_selector ? 'confirmed' : 'pending'),
    postcondition_page_id: stepData.postcondition_page_id || null,
    throw_if_empty: stepData.throw_if_empty || null,
    loop: stepData.loop || null,
    is_verify_step: stepData.is_verify_step || false,
    evidence: stepData.evidence || null,
    fix_history: [],
  };
  session.steps.splice(insertIndex, 0, step);
  renumber(session.steps);
  return saveSession(skillDir, session);
}

function deleteStep(skillDir, seq) {
  const session = loadSession(skillDir);
  const index = session.steps.findIndex((s) => s.seq === seq);
  if (index === -1) {
    throw new Error(`No step with seq ${seq}`);
  }
  session.steps.splice(index, 1);
  renumber(session.steps);
  return saveSession(skillDir, session);
}

function addHandler(skillDir, handler) {
  const session = loadSession(skillDir);
  session.handlers.push(JSON.parse(JSON.stringify(handler)));
  return saveSession(skillDir, session);
}

function confirmStep(skillDir, stepNum, verifySelector) {
  const session = loadSession(skillDir);
  const step = session.steps.find(s => s.seq === stepNum);
  if (!step) throw new Error(`Step ${stepNum} not found in session`);

  step.verify_selector = verifySelector;
  step.verify_status = 'confirmed';

  saveSession(skillDir, session);

  return {
    step: stepNum,
    verify_selector: verifySelector,
    status: 'confirmed',
  };
}

module.exports = {
  initWorkspace,
  loadSession,
  saveSession,
  loadPages,
  loadLatestDump,
  saveDumpSnapshot,
  savePageSnapshot,
  recordWalk,
  fixStep,
  insertStep,
  deleteStep,
  addHandler,
  confirmStep,
  dumpsDir,
  pagesDir,
};
