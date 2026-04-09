'use strict';

const { sleep } = require('./utils');

function defaultSnapshotsEqual(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

async function sampleUntilSettled({
  initialSnapshot,
  sampleSnapshot,
  waitDelaysMs = [],
  snapshotsEqual = defaultSnapshotsEqual,
  sleepFn = sleep,
}) {
  const rounds = [];
  let previousSnapshot = initialSnapshot;
  let finalSnapshot = initialSnapshot;
  let elapsedMs = 0;

  for (const delay of waitDelaysMs) {
    const waitMs = Number.isFinite(Number(delay)) && Number(delay) > 0 ? Number(delay) : 0;
    if (waitMs > 0) {
      await sleepFn(waitMs);
    }
    elapsedMs += waitMs;

    finalSnapshot = await sampleSnapshot();
    rounds.push({ delay_ms: waitMs, snapshot: finalSnapshot });

    if (snapshotsEqual(previousSnapshot, finalSnapshot)) {
      return {
        finalSnapshot,
        rounds,
        pageChanged: !snapshotsEqual(initialSnapshot, finalSnapshot),
        pageStable: true,
        settledAfterMs: elapsedMs,
        sampleWindowMs: elapsedMs,
      };
    }

    previousSnapshot = finalSnapshot;
  }

  return {
    finalSnapshot,
    rounds,
    pageChanged: !snapshotsEqual(initialSnapshot, finalSnapshot),
    pageStable: false,
    settledAfterMs: null,
    sampleWindowMs: elapsedMs,
  };
}

module.exports = {
  sampleUntilSettled,
};
