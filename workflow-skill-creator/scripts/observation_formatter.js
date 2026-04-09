'use strict';

/**
 * Observation Formatter
 *
 * Transforms raw device dump data into agent-readable annotated output.
 * Three-stage pipeline: Parse → Analyze → Format.
 *
 * Parse:   parseDump / parseDumpLine — text to structured data
 * Analyze: computeDiff, computeCapabilities — derive what changed + what's interactive
 * Format:  formatAnnotatedDump — assemble final text output
 *
 * annotateDump() is the public API that runs the full pipeline.
 */

const { selectorProofScore, isAgentRelevant, computeRelevanceThreshold } = require('./semantic_policy');

// ============================================================
// Stage 1: Parse
// ============================================================

/**
 * Parse a compact dump line into structured data.
 * Extracts identity (text, resource_id, content_desc), class, depth, and interaction attributes.
 */
function parseDumpLine(line) {
  const raw = line;
  const indent = (line.match(/^(\s*)/) || ['', ''])[1];
  const depth = indent.length;

  const indexMatch = line.match(/\[(\d+)\]/);
  const index = indexMatch ? parseInt(indexMatch[1], 10) : null;

  const classMatch = line.match(/\]\s+([\w.]+)/);
  const className = classMatch ? classMatch[1] : null;

  const attrs = {};
  const textMatch = line.match(/text="([^"]*)"/);
  if (textMatch) attrs.text = textMatch[1];
  const resIdMatch = line.match(/resource-id="([^"]*)"/);
  if (resIdMatch) attrs.resource_id = resIdMatch[1];
  const contentDescMatch = line.match(/content-desc="([^"]*)"/);
  if (contentDescMatch) attrs.content_desc = contentDescMatch[1];

  attrs.clickable = /\bclickable=true\b/.test(line);
  attrs.long_clickable = /\blong-clickable=true\b/.test(line);
  attrs.scrollable = /\bscrollable=true\b/.test(line);
  attrs.enabled = !/\benabled=false\b/.test(line);
  attrs.focusable = /\bfocusable=true\b/.test(line);

  return { indent, depth, index, className, attrs, raw };
}

/**
 * Parse a full compact dump text into an array of parsed lines.
 * Skips the header line (Screen ...) and blank lines.
 */
function parseDump(dumpText) {
  if (!dumpText) return [];
  return dumpText.split('\n').slice(1)
    .filter(line => line.trim())
    .map(line => parseDumpLine(line));
}

// ============================================================
// Stage 2: Analyze
// ============================================================

/**
 * Identity key for diffing (pick-one: content_desc > text > resource_id).
 * Matches nodeToSelector/nodeKey in authoring_flow.js.
 */
function dumpLineKey(attrs) {
  if (attrs.content_desc) return JSON.stringify({ content_desc: attrs.content_desc });
  if (attrs.text) return JSON.stringify({ text: attrs.text });
  if (attrs.resource_id) return JSON.stringify({ resource_id: attrs.resource_id });
  return null;
}

/**
 * Full selector for scoring (include-all: text + content_desc + resource_id).
 * Differs from dumpLineKey (pick-one for identity).
 */
function buildSelector(attrs) {
  const sel = {};
  if (attrs.text) sel.text = attrs.text;
  if (attrs.content_desc) sel.content_desc = attrs.content_desc;
  if (attrs.resource_id) sel.resource_id = attrs.resource_id;
  return Object.keys(sel).length > 0 ? sel : null;
}

/** Score a dump line's attributes as a proof selector. */
function scoreDumpLine(attrs) {
  const sel = buildSelector(attrs);
  return sel ? selectorProofScore(sel) : null;
}

/**
 * Compute before/after diff: which elements are new, which removed.
 * Returns { beforeKeys, afterKeys, afterEntries[] } where each entry
 * has { parsed, key, sel, line, isNew }.
 */
function computeDiff(afterParsed, beforeParsed) {
  const beforeKeys = new Set();
  for (const p of beforeParsed) {
    const key = dumpLineKey(p.attrs);
    if (key) beforeKeys.add(key);
  }

  const afterKeys = new Set();
  const afterEntries = afterParsed.map(parsed => {
    const key = dumpLineKey(parsed.attrs);
    if (key) afterKeys.add(key);
    const sel = buildSelector(parsed.attrs);
    const isNew = key !== null && beforeKeys.size > 0 && !beforeKeys.has(key);
    return { parsed, key, sel, line: parsed.raw, isNew };
  });

  // Removed: in before but not in after, agent-relevant only
  const removedLabels = [];
  for (const p of beforeParsed) {
    const key = dumpLineKey(p.attrs);
    if (key && !afterKeys.has(key)) {
      const label = p.attrs.text || p.attrs.content_desc;
      if (label) removedLabels.push(label);
    }
  }

  return { beforeKeys, afterKeys, afterEntries, removedLabels };
}

/**
 * Compute interaction capabilities for each element from hierarchy.
 *
 * Rules:
 *   [tap]      — clickable (self or ancestor). Inherited.
 *   [long]     — long-clickable (self or ancestor). Inherited.
 *   [scroll]   — scrollable. Self only.
 *   [input]    — EditText + focusable. Self only.
 *   [disabled] — enabled=false. Overrides all.
 */
function computeCapabilities(parsedLines) {
  const result = new Map();
  const ancestorStack = [];

  for (let i = 0; i < parsedLines.length; i++) {
    const { depth, attrs, className } = parsedLines[i];

    while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].depth >= depth) {
      ancestorStack.pop();
    }

    if (attrs.enabled === false) {
      result.set(i, { tags: ['disabled'] });
      ancestorStack.push({ depth, clickable: false, longClickable: false });
      continue;
    }

    const tags = [];

    const selfClickable = attrs.clickable === true;
    if (selfClickable || ancestorStack.some(a => a.clickable)) tags.push('tap');

    const selfLong = attrs.long_clickable === true;
    if (selfLong || ancestorStack.some(a => a.longClickable)) tags.push('long');

    if (attrs.scrollable === true) tags.push('scroll');

    const isInputClass = className && (
      className.includes('EditText') ||
      className.includes('AutoCompleteTextView') ||
      className.includes('SearchView')
    );
    if (isInputClass && attrs.focusable) tags.push('input');

    result.set(i, { tags });
    ancestorStack.push({ depth, clickable: selfClickable, longClickable: selfLong });
  }

  return result;
}

// ============================================================
// Stage 3: Format
// ============================================================

/**
 * Format the analysis results into annotated dump text.
 * Each line gets: diff marker (+/ ), score, capability tags.
 */
function formatAnnotatedDump({ headerLine, activityHeader, entries, capabilities, threshold, removedLabels, hasBefore }) {
  const parts = [headerLine];
  if (activityHeader) parts.push(activityHeader);
  parts.push('');

  for (let idx = 0; idx < entries.length; idx++) {
    const { key, sel, line, isNew } = entries[idx];
    const hasIdentity = key !== null;
    const score = hasIdentity ? scoreDumpLine(entries[idx].parsed.attrs) : null;
    const relevant = sel && isAgentRelevant(sel, threshold);
    const shouldMark = isNew && relevant && hasBefore;
    const { tags } = capabilities.get(idx) || { tags: [] };

    const marker = shouldMark ? '+' : ' ';
    const capStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';

    let suffix = '';
    if (shouldMark && score !== null) {
      suffix = `  [score:${score}]${capStr}`;
    } else if (capStr && hasIdentity) {
      suffix = `  ${capStr}`;
    }

    parts.push(`${marker} ${line}${suffix}`);
  }

  if (removedLabels.length > 0) {
    parts.push('');
    parts.push('Removed from previous page:');
    for (const label of removedLabels.slice(0, 10)) {
      parts.push(`  - ${label}`);
    }
  }

  return parts.join('\n');
}

// ============================================================
// Public API: Pipeline orchestrator
// ============================================================

/**
 * Annotate a compact dump with diff markers, scores, and capability tags.
 * Runs the full Parse → Analyze → Format pipeline.
 *
 * @param {string} afterDump - Compact dump text of the after-action page
 * @param {string|null} beforeDump - Compact dump text of the before-action page (null for first step)
 * @param {object} [options] - { beforeActivity, afterActivity }
 * @returns {string} Annotated dump text
 */
function annotateDump(afterDump, beforeDump, options = {}) {
  if (!afterDump) return '';

  // Parse
  const afterParsed = parseDump(afterDump);
  const beforeParsed = beforeDump ? parseDump(beforeDump) : [];
  const headerLine = afterDump.split('\n')[0] || '';

  // Analyze
  const diff = computeDiff(afterParsed, beforeParsed);
  const afterSelectors = diff.afterEntries.map(e => e.sel).filter(Boolean);
  const threshold = computeRelevanceThreshold(afterSelectors);
  const capabilities = computeCapabilities(afterParsed);

  // Filter removed to agent-relevant only
  const removedLabels = diff.removedLabels.filter(label => {
    // removedLabels already only has text/content_desc labels (no resource_id-only)
    return true;
  });

  // Activity header
  let activityHeader = null;
  if (options.afterActivity) {
    activityHeader = options.beforeActivity && options.beforeActivity !== options.afterActivity
      ? `Activity: ${options.afterActivity} (was: ${options.beforeActivity})`
      : `Activity: ${options.afterActivity}`;
  }

  // Format
  return formatAnnotatedDump({
    headerLine,
    activityHeader,
    entries: diff.afterEntries,
    capabilities,
    threshold,
    removedLabels,
    hasBefore: beforeParsed.length > 0,
  });
}

module.exports = {
  annotateDump,
  computeCapabilities,
  parseDumpLine,
  parseDump,
  computeDiff,
  dumpLineKey,
  scoreDumpLine,
  buildSelector,
};
