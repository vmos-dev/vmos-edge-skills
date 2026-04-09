#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, isValidSkillName, parseArgs, writeText } = require('./utils');

const COMMANDS = {
  init: 'Create authoring workspace, reset device, snapshot start state',
  walk: 'Record one step: snapshot → act → snapshot → capture evidence',
  'compile-view': 'Output compile contract JSON (goal + locked_evidence + compiler_hints)',
  'compile-plan': 'Validate evidence completeness and generate compilation strategy',
  'compile-write': 'Generate child skill package (workflow-script.json + SKILL.md + run.js) and validate',
  'quality-gate': 'Read quality-review.json, pass if score ≥ 90, list issues if not',
  'admission-check': 'Validate Phase 0 inputs (no device contact)',
  confirm: 'Set verify-selector for a pending walk step',
  repair: 'Modify session step data without device (Phase 3 evidence repair)',
  status: 'Show recording progress (steps, verify status, intent types)',
};

const COMMAND_HELP = {
  'admission-check': `Usage: admission-check [options]

Validate Phase 0 inputs before init (no device contact).

Required:
  --base-url <url>              Device API URL (or set WORKFLOW_BASE_URL)
  --task <text>                 Task description

Optional:
  --app <package>               Android package name (resolved by agent via packages command)
  --app-name <name>             App display name (resolved by agent via packages command)
  --start-page <page>           Expected start page (inferred from task)
  --login-state <state>         Login state: logged-in or guest (inferred from task)
  --name <name>                 Skill name (derived from task by agent)`,

  init: `Usage: init --dir <path> [options]

Initialize an authoring workspace. Resets device and snapshots start state.
All parameters except --dir, --task, --base-url are resolved by agent in Phase 0.

Required:
  --dir <path>          Workspace directory
  --name <name>         Skill name (lowercase, digits, hyphens)
  --task <text>         Task description
  --base-url <url>      Device API URL (or set WORKFLOW_BASE_URL)
  --app <package>       Android package name (resolved by agent via packages command)
  --app-name <name>     App display name (resolved by agent via packages command)

Optional:
  --start-page <page>            Expected start page
  --login-state <state>          Login state`,

  walk: `Usage: walk --dir <path> [options]

Record one step: snapshot > act > snapshot > capture evidence.

Required:
  --dir <path>                Workspace directory
  --action <json>             Action to execute (API format from action-registry.md)
  --description <text>        Business meaning of this step
  --intent-type <type>        launch|navigate|act|seek|reveal|macro|handler|verify

After walk, use 'confirm --step N --verify <json>' to set verify based on changes.

Optional — semantic hints:
  --step-key <name>           Semantic step key (e.g. launch_settings). Auto-derived if omitted.
  --verify-selector <json>    Selector proving step success (skip confirm if provided)
  --as-handler <name>         Record as exception handler (e.g. permission_dialog)
  --loop <json>               Retry config: {"max_count":N,"interval":ms} for seek/reveal steps
  --success-condition <json>  Custom completion: {"type":"selector_found","selector":{...}}
  --postcondition-page-id <id>  Expected page ID after step (warns if mismatch)
  --retry-policy <json>       Override timing: {"wait_timeout":ms,"barrier_sleep":ms}
  --throw-if-empty            Fail if action selector finds no nodes
  --is-verify-step            Mark as verification-only (no side effects)

Repair (one at a time):
  --fix-step <N>              Replace step N with current --action
  --insert-after <N>          Insert new step after step N
  --delete-step <N>           Delete step N`,

  'compile-view': `Usage: compile-view --dir <path>

Output the compile contract JSON (goal + evidence + hints).

Required:
  --dir <path>    Workspace directory`,

  'compile-plan': `Usage: compile-plan --dir <path>

Validate evidence completeness and generate compilation strategy.
Checks that all steps have sufficient selectors and proof before compile-write.

Required:
  --dir <path>    Workspace directory`,

  'compile-write': `Usage: compile-write --dir <path> [options]

Generate child skill package (workflow-script.json, SKILL.md, run.js) and validate.

Required:
  --dir <path>    Workspace directory`,

  'quality-gate': `Usage: quality-gate --dir <path>

Verify quality-reviewer score >= 90. Reads authoring/quality-review.json.

Required:
  --dir <path>    Workspace directory`,

  repair: `Usage: repair --dir <path> [options]

Modify session step data without device connection (Phase 3 evidence repair).
Use after quality-gate fails to fix selectors, verify, or delete waste steps
from existing dump evidence.

Required:
  --dir <path>           Workspace directory

Operations (one per invocation):
  --step <N> --selector <json>    Replace action selector for step N
  --step <N> --verify <json>      Replace verify selector for step N
  --step <N> --intent-type <type> Change intent type for step N
  --delete-step <N>               Delete step N and renumber remaining steps`,

  confirm: `Usage: confirm --dir <path> --step <N> --verify <json>

Confirm the verify-selector for a pending walk step based on observed changes.

Required:
  --dir <path>           Workspace directory
  --step <N>             Step number to confirm
  --verify <json>        Selector that proves the step succeeded`,

  status: `Usage: status --dir <path>

Show authoring session progress.

Required:
  --dir <path>    Workspace directory`,
};


function parseOptionalBooleanArg(raw, flagName) {
  if (raw === undefined) {
    return false;
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

const VALID_INTENT_TYPES = ['launch', 'navigate', 'act', 'seek', 'reveal', 'macro', 'handler', 'verify'];
const VALID_LOGIN_STATES = ['logged-in', 'guest'];

async function cmdAdmissionCheck(args) {
  const errors = [];
  const warnings = [];

  if (!args['base-url'] && !process.env.WORKFLOW_BASE_URL) {
    errors.push('Missing --base-url or WORKFLOW_BASE_URL');
  }
  if (!args.task) errors.push('Missing --task');
  if (!args['start-page']) {
    warnings.push('No --start-page specified; will assume home screen');
  }
  if (!args['login-state']) {
    warnings.push('No --login-state specified; will assume no login required (guest)');
  }
  if (args['login-state'] && !VALID_LOGIN_STATES.includes(args['login-state'])) {
    errors.push(`Invalid --login-state "${args['login-state']}". Valid: ${VALID_LOGIN_STATES.join(', ')}`);
  }

  if (args.name && !isValidSkillName(args.name)) {
    errors.push('--name must use lowercase letters, digits, and hyphens only, under 64 characters');
  }

  const passed = errors.length === 0;
  return {
    verdict: passed ? 'PASS' : 'FAIL',
    errors,
    warnings,
    message: passed
      ? 'Admission check passed. Proceed to Phase 1 (init).'
      : `Admission check failed: ${errors.length} error(s). Fix before proceeding.`,
  };
}

async function cmdInit(args, { workspace, deviceApi }) {
  const dir = path.resolve(args.dir);
  if (!args.name) throw new Error('init requires --name');
  if (!isValidSkillName(args.name)) {
    throw new Error('init requires --name to use lowercase letters, digits, and hyphens only, under 64 characters');
  }
  if (!args.task) throw new Error('init requires --task');

  const baseUrl = args['base-url'] || process.env.WORKFLOW_BASE_URL;
  if (!baseUrl) throw new Error('init requires --base-url or WORKFLOW_BASE_URL env');

  // Reset device to a known state before creating workspace.  This is the
  // first and only reset in the entire flow — it guarantees a clean start
  // and doubles as a connectivity check.
  const api = deviceApi || require('./device_api');
  try {
    await api.resetDevice(baseUrl);
  } catch (e) {
    throw new Error(`Device not reachable at ${baseUrl}: ${e.message}. Please verify the device API URL and try again.`);
  }

  // Grant all permissions to the target app before recording starts.
  // Permissions are infrastructure — granting upfront prevents permission
  // dialogs from interrupting the recording flow.
  const targetApp = args.app || '';
  if (targetApp) {
    await api.grantAllPermissions(baseUrl, targetApp);
  }

  // Phase 0 should have resolved --app and --app-name already.
  // init just passes them through — no fallback lookup here.
  const appName = args['app-name'] || '';

  ensureDir(dir);
  ensureDir(path.join(dir, 'evals'));
  ensureDir(path.join(dir, 'scripts'));

  const session = workspace.initWorkspace(dir, {
    skillName: args.name,
    task: args.task,
    app: args.app || '',
    appName,
    baseUrl,
  });

  // Capture initial checkpoint (device at home screen after reset).
  // This is checkpoint 0 — the first step's Observe phase validates against it.
  let initSnapshot = null;
  try {
    const pageSnapshot = require('./page_snapshot');
    const dump = await api.dump(baseUrl);
    let topActivity = null;
    try { topActivity = await api.topActivity(baseUrl); } catch (_) {}
    initSnapshot = {
      package_name: topActivity?.package_name || null,
      top_activity: topActivity?.class_name || topActivity?.activity || null,
    };
    const normalized = pageSnapshot.normalizeSnapshot({
      packageName: topActivity?.package_name || null,
      topActivity,
      dump,
    });
    workspace.savePageSnapshot(dir, 'init_checkpoint.json', normalized);
  } catch (_) {
    // Non-fatal: checkpoint capture failed, recording can still proceed.
  }

  return {
    ...session,
    init_checkpoint: initSnapshot,
  };
}

async function cmdStatus(args, { workspace }) {
  const dir = path.resolve(args.dir);
  const session = workspace.loadSession(dir);

  // Checkpoint: after-state of the last confirmed step.
  // The next step's Observe phase should verify the device matches this.
  const lastConfirmed = [...session.steps].reverse().find(s => s.verify_status === 'confirmed');
  let checkpoint = null;
  if (lastConfirmed) {
    checkpoint = {
      step_seq: lastConfirmed.seq,
      description: lastConfirmed.description,
      after_page: lastConfirmed.after_page || null,
    };
  }

  // Infer next step guidance for the agent
  const steps = session.steps;
  let next_step;
  if (steps.length === 0) {
    const pkg = session.app || '<package>';
    const name = session.app_name || 'the target app';
    next_step = `Launch ${name}: walk --dir ${args.dir} --launch ${pkg} --intent-type launch --description "Launch ${name}"`;
  } else {
    const pendingVerify = steps.filter(s => s.verify_status === 'pending');
    const lastStep = steps[steps.length - 1];
    if (pendingVerify.length > 0) {
      const seqs = pendingVerify.map(s => s.seq).join(', ');
      next_step = `Confirm verify selector for step(s) ${seqs}: confirm --dir $DIR --step N --verify '<selector>'`;
    } else if (lastStep && !lastStep.verify_selector) {
      next_step = `Last step (${lastStep.seq}) has no verify_selector. The compiler requires terminal verification. Use: confirm --dir $DIR --step ${lastStep.seq} --verify '<selector>'`;
    } else {
      next_step = 'All steps confirmed. Run compile pipeline: compile-view → compile-plan → compile-write → quality-review → quality-gate';
    }
  }

  return {
    skill_name: session.skill_name,
    task: session.task,
    app: session.app,
    status: session.status,
    step_count: session.steps.length,
    handler_count: (session.handlers || []).length,
    checkpoint,
    next_step,
    steps: session.steps.map(s => ({
      seq: s.seq,
      description: s.description,
      success: s.success,
      verify_status: s.verify_status || 'pending',
      intent_type: s.intent_type || null,
    })),
  };
}

async function cmdCompileView(args, { workspace, flow }) {
  const dir = path.resolve(args.dir);
  const session = workspace.loadSession(dir);
  if (session.steps.length === 0) throw new Error('No steps to compile');

  // Gate: all steps must have verify confirmed before compilation
  const pendingSteps = session.steps.filter(s => s.verify_status === 'pending');
  const invalidatedSteps = session.steps.filter(s => s.verify_status === 'invalidated');
  if (invalidatedSteps.length > 0) {
    const invalidSeqs = invalidatedSteps.map(s => s.seq).join(', ');
    throw new Error(
      `Steps [${invalidSeqs}] were invalidated by a fix-step. ` +
      `Re-walk or re-confirm these steps before compiling.`
    );
  }
  if (pendingSteps.length > 0) {
    const pendingSeqs = pendingSteps.map(s => s.seq).join(', ');
    throw new Error(
      `Steps [${pendingSeqs}] have pending verify. ` +
      `Use 'confirm --step N --verify <json>' to confirm each before compiling.`
    );
  }

  const compilerView = flow.buildCompilerView(session);

  // Load page snapshots inline so the AI has full context
  const pages = {};
  for (const step of compilerView.steps) {
    for (const pageRef of [step.locked_evidence?.before_page, step.locked_evidence?.after_page]) {
      if (!pageRef) continue;
      const normalized = String(pageRef).replace(/^authoring\//, '');
      const fullPath = path.join(dir, 'authoring', normalized);
      try {
        pages[pageRef] = JSON.parse(require('fs').readFileSync(fullPath, 'utf8'));
      } catch (_) {
        pages[pageRef] = null;
      }
    }
  }

  return { compiler_view: compilerView, pages };
}

async function cmdCompilePlan(args, { workspace, flow, compiler }) {
  const dir = path.resolve(args.dir);
  const session = workspace.loadSession(dir);
  if (session.steps.length === 0) throw new Error('No steps to compile');
  return {
    compilation_plan: compiler.buildCompilationPlan({
      skillDir: dir,
      session: flow.buildCompilerView(session),
    }),
  };
}

async function cmdCompileWrite(args, { workspace, flow, compiler, validator }) {
  const dir = path.resolve(args.dir);
  const session = workspace.loadSession(dir);
  if (session.steps.length === 0) throw new Error('No steps to compile');
  const compilerView = flow.buildCompilerView(session);
  const compilationPlan = compiler.buildCompilationPlan({
    skillDir: dir,
    session: compilerView,
  });
  // Build artifacts in memory — do NOT write to the final child dir yet.
  const artifacts = compiler.buildCompiledArtifacts({
    skillDir: dir,
    session: compilerView,
    plan: compilationPlan,
  });

  // Stage: write to a hidden directory that skill_structure.js ignores.
  const stagingDir = path.join(dir, '.compile-staging');
  const stagedRelPaths = [];
  for (const [relativePath, content] of Object.entries(artifacts.files)) {
    writeText(path.join(stagingDir, relativePath), content);
    stagedRelPaths.push(relativePath);
  }

  // Validate against the staging directory.
  const validation = validator || require('./quick_validate');
  const validationIssues = [
    ...validation.validateChildSkillStructure(stagingDir),
    ...validation.validateChildSkill(stagingDir),
  ];

  if (validationIssues.length > 0) {
    // Validation failed — clean staging so no half-baked artifacts remain.
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`Generated child skill is invalid:\n${validationIssues.join('\n')}`);
  }

  // Promote: rename each file from staging into the final child dir.
  const promotedFiles = [];
  for (const relativePath of stagedRelPaths) {
    const src = path.join(stagingDir, relativePath);
    const dest = path.join(dir, relativePath);
    ensureDir(path.dirname(dest));
    fs.renameSync(src, dest);
    promotedFiles.push(dest);
  }

  // Remove the now-empty staging tree.
  fs.rmSync(stagingDir, { recursive: true, force: true });

  // Write compile-report.json into authoring/ for quality-reviewer consumption.
  // This is an authoring artifact — it does not ship with the child skill package.
  const compileReport = compiler.buildCompileReport(compilationPlan, compilerView);
  writeText(path.join(dir, 'authoring', 'compile-report.json'), JSON.stringify(compileReport, null, 2));

  // Extract terminal verify from the last step in the plan
  const lastStep = compilationPlan.confirmedSteps[compilationPlan.confirmedSteps.length - 1];
  const terminalVerify = lastStep?.verify_selector || null;

  return {
    summary: {
      verdict: 'PASS',
      step_count: compilationPlan.confirmedSteps.length,
      files_generated: promotedFiles.map(f => path.relative(dir, f)),
      terminal_verify: terminalVerify,
      warnings: validationIssues,
    },
    compilation_plan: compilationPlan,
    artifacts: promotedFiles,
    validation_issues: validationIssues,
  };
}

const QUALITY_GATE_THRESHOLD = 90;

function cmdQualityGate(args) {
  const dir = path.resolve(args.dir);
  const reviewPath = path.join(dir, 'authoring', 'quality-review.json');

  if (!fs.existsSync(reviewPath)) {
    throw new Error(
      'Quality gate: authoring/quality-review.json not found. ' +
      'Dispatch the quality-reviewer agent and ensure it writes its verdict to this file before proceeding to Phase 4.'
    );
  }

  let review;
  try {
    review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  } catch (e) {
    throw new Error(`Quality gate: failed to parse authoring/quality-review.json — ${e.message}`);
  }

  const score = typeof review.overall_score === 'number' ? review.overall_score : null;
  if (score === null) {
    throw new Error(
      'Quality gate: authoring/quality-review.json is missing "overall_score". ' +
      'Re-run the quality-reviewer agent to produce a valid verdict.'
    );
  }

  if (score < QUALITY_GATE_THRESHOLD) {
    const issues = (review.fix_suggestions || [])
      .filter(s => s.priority === 'high' || s.priority === 'critical')
      .map(s => `  [${s.priority}] ${s.step || 'workflow'}: ${s.issue}`)
      .join('\n');
    throw new Error(
      `Quality gate FAILED: score ${score} < ${QUALITY_GATE_THRESHOLD}.\n` +
      (issues ? `Issues to fix:\n${issues}\n` : '') +
      'Evidence Repair: read dump files for affected steps, use repair command to fix selectors/verify, then recompile. Only re-record on device if dump evidence is insufficient.'
    );
  }

  return {
    verdict: 'PASS',
    overall_score: score,
    threshold: QUALITY_GATE_THRESHOLD,
    message: `Quality gate passed (score ${score} ≥ ${QUALITY_GATE_THRESHOLD}). Proceed to Phase 4 delivery.`,
  };
}

/**
 * Evidence-based repair: modify session step data without device.
 * Supports: change selector, change verify, change intent-type, delete step.
 * Used in Phase 3 when quality-gate fails — fix from existing dump evidence.
 */
async function cmdRepair(args, { workspace }) {
  const dir = path.resolve(args.dir);
  const session = workspace.loadSession(dir);

  // Delete step
  if (args['delete-step']) {
    const seq = Number(args['delete-step']);
    const index = session.steps.findIndex(s => s.seq === seq);
    if (index === -1) throw new Error(`Step ${seq} not found`);

    const deleted = session.steps.splice(index, 1)[0];
    // Renumber remaining steps
    session.steps.forEach((s, i) => { s.seq = i + 1; });
    workspace.saveSession(dir, session);

    return {
      action: 'delete',
      deleted_step: seq,
      deleted_description: deleted.description,
      remaining_steps: session.steps.length,
    };
  }

  // Step modification (selector, verify, intent-type)
  const stepNum = Number(args.step);
  if (!stepNum || stepNum < 1) throw new Error('--step is required for selector/verify/intent-type repair');

  const step = session.steps.find(s => s.seq === stepNum);
  if (!step) throw new Error(`Step ${stepNum} not found`);

  const changes = {};

  if (args.selector) {
    const selector = typeof args.selector === 'string' ? JSON.parse(args.selector) : args.selector;
    step.action = { ...step.action, params: { ...step.action.params, selector } };
    changes.selector = selector;
  }

  if (args.verify) {
    const verify = typeof args.verify === 'string' ? JSON.parse(args.verify) : args.verify;
    step.verify_selector = verify;
    step.verify_status = 'confirmed';
    changes.verify = verify;
  }

  if (args['intent-type']) {
    step.intent_type = args['intent-type'];
    changes.intent_type = args['intent-type'];
  }

  if (Object.keys(changes).length === 0) {
    throw new Error('No repair operation specified. Use --selector, --verify, --intent-type, or --delete-step.');
  }

  workspace.saveSession(dir, session);

  return {
    action: 'modify',
    step: stepNum,
    changes,
    description: step.description,
  };
}

async function cmdConfirm(args, { workspace }) {
  const dir = path.resolve(args.dir);
  const stepNum = Number(args.step);
  if (!stepNum || stepNum < 1) throw new Error('--step must be a positive integer');

  const verifyRaw = args.verify;
  if (!verifyRaw) throw new Error('--verify is required (selector JSON)');

  let verifySelector;
  try {
    verifySelector = JSON.parse(verifyRaw);
  } catch (e) {
    throw new Error(`Invalid --verify JSON: ${e.message}`);
  }

  return workspace.confirmStep(dir, stepNum, verifySelector);
}

async function runCommand(command, args, deps = {}) {
  const workspace = deps.workspace || require('./authoring_workspace');
  const flow = deps.flow || require('./authoring_flow');
  const compiler = deps.compiler || require('./authoring_compiler');

  switch (command) {
    case 'admission-check':
      return cmdAdmissionCheck(args);
    case 'init':
      return cmdInit(args, { workspace, deviceApi: deps.deviceApi });
    case 'walk':
      if (args['intent-type'] && !VALID_INTENT_TYPES.includes(args['intent-type'])) {
        throw new Error(`Invalid --intent-type "${args['intent-type']}". Valid: ${VALID_INTENT_TYPES.join(', ')}`);
      }
      return flow.walk({ ...args, dir: path.resolve(args.dir) }, deps);
    case 'confirm':
      return cmdConfirm(args, { workspace });
    case 'repair':
      return cmdRepair(args, { workspace });
    case 'compile-view':
      return cmdCompileView(args, { workspace, flow });
    case 'compile-plan':
      return cmdCompilePlan(args, { workspace, flow, compiler });
    case 'compile-write':
      return cmdCompileWrite(args, { workspace, flow, compiler, validator: deps.validator });
    case 'quality-gate':
      return cmdQualityGate(args);
    case 'status':
      return cmdStatus(args, { workspace });
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log('Usage: node scripts/skill_cli.js <command> --dir <skill-dir> [options]\n');
  console.log('Commands:');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(22)} ${desc}`);
  }
  console.log('\nEnvironment:');
  console.log('  WORKFLOW_BASE_URL    Default --base-url if flag is omitted');
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command || !COMMANDS[command]) {
    printUsage();
    process.exit(1);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    if (COMMAND_HELP[command]) {
      console.log(COMMAND_HELP[command]);
    } else {
      console.log(`${command}: ${COMMANDS[command]}`);
    }
    process.exit(0);
  }
  const args = parseArgs(argv.slice(1));
  if (!args.dir && command !== 'admission-check') throw new Error('--dir is required');
  const result = await runCommand(command, args);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

module.exports = { COMMANDS, runCommand, main };
