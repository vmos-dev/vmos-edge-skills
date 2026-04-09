'use strict';

const fs = require('fs');

const ROOT_ALLOWED = new Set([
  'authoring',
  'SKILL.md',
  'agents',
  'assets',
  'evals',
  'scripts',
]);

const ROOT_SKILL_ALLOWED = new Set([
  'SKILL.md',
  'agents',
  'references',
  'scripts',
  'assets',
  'tests',
  'docs',
]);

const ROOT_SKILL_REQUIRED = Object.freeze([
  'SKILL.md',
  'agents/quality-reviewer.md',
  'agents/device-grader.md',
  'agents/repair-comparator.md',
  'references/recording-guide.md',
  'references/compilation-contract.md',
  'references/compilation-checklist.md',
  'references/engine-runtime.md',
  'references/action-registry.md',
  'references/child-skill-guide.md',
  'references/repair-guide.md',
  'references/tools.md',
  'references/eval-guide.md',
  'scripts/authoring_workspace.js',
  'scripts/authoring_flow.js',
  'scripts/authoring_compiler.js',
  'scripts/page_snapshot.js',
  'scripts/probe.js',
  'scripts/device_api.js',
  'scripts/device_cli.js',
  'scripts/reliability_policy.js',
  'scripts/settle_detector.js',
  'scripts/skill_cli.js',
  'scripts/skill_structure.js',
  'scripts/quick_validate.js',
  'scripts/semantic_policy.js',
  'scripts/utils.js',
  'agents/openai.yaml',
  'assets/child.SKILL.md.tpl',
  'assets/child.openai.yaml.tpl',
  'assets/child.business-spec.json.tpl',
  'assets/child.workflow-script.json.tpl',
  'assets/child.evals.json.tpl',
  'assets/child.run.js.tpl',
]);

const AUTHORING_ALLOWED = new Set([
  'session.json',
  'pages',
  'dumps',
  'compile-report.json',
  'quality-review.json',
]);

const ASSETS_ALLOWED = new Set([
  'business-spec.json',
  'workflow-script.json',
]);

const SCRIPTS_ALLOWED = new Set([
  'run.js',
]);

const EVALS_ALLOWED = new Set([
  'evals.json',
]);

function listUnexpectedEntries(dir, allowedEntries, fsImpl = fs) {
  if (!fsImpl.existsSync(dir)) {
    return [];
  }

  return fsImpl.readdirSync(dir)
    .filter((entry) => !entry.startsWith('.'))
    .filter((entry) => !allowedEntries.has(entry))
    .sort();
}

function validateAllowedEntries(dir, allowedEntries, prefix) {
  return listUnexpectedEntries(dir, allowedEntries)
    .map((entry) => `unexpected ${prefix} entry: ${entry}`);
}

module.exports = {
  ROOT_ALLOWED,
  ROOT_SKILL_ALLOWED,
  ROOT_SKILL_REQUIRED,
  ASSETS_ALLOWED,
  AUTHORING_ALLOWED,
  EVALS_ALLOWED,
  SCRIPTS_ALLOWED,
  validateAllowedEntries,
};
