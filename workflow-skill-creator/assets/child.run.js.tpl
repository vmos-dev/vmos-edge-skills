#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// SDK responses use: { request_id, code, msg, data, cost }
// code=200 means success, data contains the actual result.
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
      normalized.ok = Boolean(payload.success) && response.ok;
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
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${apiPath.replace(/^\//, '')}`, {
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

// After normalizeResponse, result.data is the unwrapped WorkflowExecution.
// SDK uses @SerializedName("execution_id") so the field is always snake_case.
function pickExecutionId(result) {
  return result?.data?.execution_id
    || result?.data?.executionId
    || null;
}

async function waitForExecution(baseUrl, executionId, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await postJson(baseUrl, 'workflow/execution_get', { execution_id: executionId });
    const status = result?.data?.status;
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return {
    ok: false,
    httpStatus: 408,
    data: null,
    error: `Timed out waiting for execution ${executionId}`,
    raw: null
  };
}

async function run() {
  const skillDir = path.resolve(__dirname, '..');
  const businessSpec = readJson(path.join(skillDir, 'assets', 'business-spec.json'));
  const workflowScript = readJson(path.join(skillDir, 'assets', 'workflow-script.json'));

  const baseUrl = process.env.CONTROL_API_URL;
  if (!baseUrl) {
    throw new Error('Missing CONTROL_API_URL environment variable');
  }

  const executeResult = await postJson(baseUrl, 'workflow/execute', workflowScript);
  const executionId = pickExecutionId(executeResult);
  const timeoutMs = businessSpec.runtime?.timeoutMs || 30000;
  const pollIntervalMs = businessSpec.runtime?.pollIntervalMs || 1000;

  let finalResult = executeResult;
  if (executeResult.ok && executionId) {
    finalResult = await waitForExecution(baseUrl, executionId, timeoutMs, pollIntervalMs);
  }

  const finalStatus = finalResult?.data?.status || executeResult?.data?.status || null;

  const success = Boolean(finalResult.ok) && finalStatus === 'COMPLETED';

  return {
    success,
    request: workflowScript,
    initialExecution: executeResult.data,
    execution: finalResult.data,
    error: finalResult.error || null
  };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}

module.exports = { run };
