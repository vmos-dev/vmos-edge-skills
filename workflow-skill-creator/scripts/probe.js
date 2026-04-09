'use strict';

const { clone, sleep } = require('./utils');
const { snapshotsEqual } = require('./page_snapshot');

function sameSnapshot(left, right) {
  return snapshotsEqual(left, right);
}

function stepRunFailed(stepResult) {
  if (!stepResult || typeof stepResult !== 'object') {
    return false;
  }
  return stepResult.succeed === false || stepResult.success === false;
}

async function captureAfterSnapshot(before, snapshotProvider, waitDelaysMs) {
  const rounds = [];
  let after = before;
  let changed = false;

  for (const delay of waitDelaysMs) {
    rounds.push(delay);
    if (delay > 0) {
      await sleep(delay);
    }

    after = await snapshotProvider();
    if (!sameSnapshot(before, after)) {
      changed = true;
      break;
    }
  }

  return { after, rounds, changed };
}

async function runProbe({
  action,
  description = null,
  stepRequest = null,
  snapshotProvider,
  device,
  expectedPageId = null,
  waitDelaysMs = [1000, 2000, 3000],
}) {
  if (!action || !action.path) {
    throw new Error('runProbe requires an action with a path');
  }
  if (!device || typeof device.runWorkflowStep !== 'function') {
    throw new Error('runProbe requires device.runWorkflowStep');
  }

  const before = await snapshotProvider();
  const runtimeStepRequest = stepRequest || (() => {
    const request = {
      actions: [clone(action)],
    };
    if (description) {
      request.description = description;
    }
    return request;
  })();
  const stepResult = await device.runWorkflowStep(runtimeStepRequest);
  const { after, rounds, changed } = await captureAfterSnapshot(before, snapshotProvider, waitDelaysMs);

  let passed = false;
  let reason = 'probe did not reach expected state';

  if (stepRunFailed(stepResult)) {
    reason = `workflow/run_step failed: ${stepResult.error || 'unknown error'}`;
  } else if (expectedPageId && after?.page_id === expectedPageId) {
    passed = true;
    reason = `after page matched expected page: ${expectedPageId}`;
  } else if (changed) {
    passed = true;
    reason = 'page changed after action';
  }

  return {
    before,
    after,
    action_result: stepResult,
    step_result: stepResult,
    wait_strategy: {
      rounds,
      changed,
    },
    verification: {
      passed,
      reason,
    },
  };
}

module.exports = {
  runProbe,
};
