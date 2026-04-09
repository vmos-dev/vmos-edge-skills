#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  collectWorkflowPolicyIssues,
  parseSkillMd,
  readJson,
  validateChildSkillDoc,
  validateOpenAiMetadata,
  validateRootReferenceDocs,
  validateRootSkillDoc,
  validateSkillFrontmatter,
  validateWorkflowPayload,
} = require('./utils');
const {
  validateAllowedEntries,
  ROOT_SKILL_ALLOWED,
  ROOT_SKILL_REQUIRED,
} = require('./skill_structure');

function validateRootSkill(targetDir) {
  const issues = [];

  issues.push(...validateAllowedEntries(targetDir, ROOT_SKILL_ALLOWED, 'root'));

  for (const relativePath of ROOT_SKILL_REQUIRED) {
    if (!fs.existsSync(path.join(targetDir, relativePath))) {
      issues.push(`missing required file: ${relativePath}`);
    }
  }

  try {
    const parsed = parseSkillMd(targetDir);
    issues.push(...validateSkillFrontmatter(parsed, { label: 'SKILL.md' }));
    issues.push(...validateRootSkillDoc(parsed));
    issues.push(...validateRootReferenceDocs(targetDir));
    issues.push(...validateOpenAiMetadata(path.join(targetDir, 'agents', 'openai.yaml'), parsed.name));
  } catch (error) {
    issues.push(error.message);
  }

  return issues;
}

function validateChildSkill(targetDir) {
  const issues = [];
  let parsed = null;
  const requiredFiles = [
    'SKILL.md',
    'assets/business-spec.json',
    'assets/workflow-script.json',
    'scripts/run.js'
  ];

  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(targetDir, relativePath))) {
      issues.push(`missing child skill file: ${relativePath}`);
    }
  }

  try {
    parsed = parseSkillMd(targetDir);
    issues.push(...validateSkillFrontmatter(parsed, { label: 'child SKILL.md' }));
    issues.push(...validateChildSkillDoc(parsed));
  } catch (error) {
    issues.push(error.message);
  }

  if (fs.existsSync(path.join(targetDir, 'assets', 'business-spec.json'))) {
    const businessSpec = readJson(path.join(targetDir, 'assets', 'business-spec.json'));
    if (!businessSpec.name) issues.push('business-spec.json is missing name');
    if (parsed && businessSpec.name && businessSpec.name !== parsed.name) {
      issues.push('business-spec.json name must match child SKILL.md name');
    }
  }

  if (fs.existsSync(path.join(targetDir, 'assets', 'workflow-script.json'))) {
    const workflowScript = readJson(path.join(targetDir, 'assets', 'workflow-script.json'));
    if (parsed && workflowScript.id && workflowScript.id !== parsed.name) {
      issues.push('workflow-script.json id must match child SKILL.md name');
    }
    issues.push(...validateWorkflowPayload(workflowScript));

  }

  if (fs.existsSync(path.join(targetDir, 'evals', 'evals.json'))) {
    const evals = readJson(path.join(targetDir, 'evals', 'evals.json'));
    if (!evals.skill_name) issues.push('evals/evals.json is missing skill_name');
    if (!Array.isArray(evals.evals)) issues.push('evals/evals.json evals must be an array');
  }

  const childOpenaiPath = path.join(targetDir, 'agents', 'openai.yaml');
  if (fs.existsSync(childOpenaiPath)) {
    issues.push(...validateOpenAiMetadata(childOpenaiPath, parsed?.name));
  }

  return issues;
}

function validateChildSkillStructure(targetDir) {
  const issues = [];
  const structure = require('./skill_structure');

  issues.push(...validateAllowedEntries(targetDir, structure.ROOT_ALLOWED, 'root'));

  const authoringDir = path.join(targetDir, 'authoring');
  issues.push(...validateAllowedEntries(authoringDir, structure.AUTHORING_ALLOWED, 'authoring'));
  issues.push(...validateAllowedEntries(path.join(targetDir, 'assets'), structure.ASSETS_ALLOWED, 'assets'));
  issues.push(...validateAllowedEntries(path.join(targetDir, 'scripts'), structure.SCRIPTS_ALLOWED, 'scripts'));
  issues.push(...validateAllowedEntries(path.join(targetDir, 'evals'), structure.EVALS_ALLOWED, 'evals'));

  return issues;
}

function main() {
  const targetDir = path.resolve(process.argv[2] || '.');
  const issues = [];

  const isRootSkill = fs.existsSync(path.join(targetDir, 'references', 'compilation-contract.md'));

  if (!fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
    issues.push('SKILL.md not found');
  } else if (isRootSkill) {
    issues.push(...validateRootSkill(targetDir));
  } else {
    issues.push(...validateChildSkillStructure(targetDir));
    issues.push(...validateChildSkill(targetDir));
  }

  if (issues.length) {
    process.stderr.write(`${issues.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write('Skill is valid.\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  collectWorkflowPolicyIssues,
  validateRootSkill,
  validateChildSkill,
  validateChildSkillStructure,
  main,
};
