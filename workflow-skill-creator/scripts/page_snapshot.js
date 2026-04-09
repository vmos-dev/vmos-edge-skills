'use strict';

const STABLE_FIELDS = [
  'resource_id',
  'text',
  'content_desc',
  'class_name',
  'index',
  'scrollable',
];

const XML_NODE_RE = /<node\b([^>]*?)(?:\/>|>)/g;
const XML_ATTR_RE = /([a-zA-Z_][\w:-]*)="([^"]*)"/g;

function normalizeDumpKey(key) {
  switch (key) {
    case 'resource-id':
      return 'resource_id';
    case 'content-desc':
      return 'content_desc';
    case 'class':
      return 'class_name';
    default:
      return key.replace(/-/g, '_');
  }
}

function parseDumpValue(rawValue) {
  if (rawValue === undefined) {
    return true;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(rawValue)) {
    return Number(rawValue);
  }
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\"/g, '"');
  }
  return rawValue;
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseXmlDump(dumpText) {
  const nodes = [];
  const xml = String(dumpText || '');

  for (const match of xml.matchAll(XML_NODE_RE)) {
    const rawAttributes = match[1] || '';
    const node = {};

    for (const attrMatch of rawAttributes.matchAll(XML_ATTR_RE)) {
      const [, rawKey, rawValue] = attrMatch;
      const key = normalizeDumpKey(rawKey);
      node[key] = parseDumpValue(decodeXmlEntities(rawValue));
    }

    if (Object.keys(node).length > 0) {
      nodes.push(node);
    }
  }

  return nodes;
}

function normalizeNode(node) {
  const output = {};
  const className = node.class_name || node.class;
  for (const key of STABLE_FIELDS) {
    const value = key === 'class_name' ? className : node[key];
    if (value !== undefined && value !== null && value !== '') {
      output[key] = value;
    }
  }
  return output;
}

function summaryScore(node) {
  const className = node.class_name || node.class || '';
  const hasText = Boolean(node.text);
  const hasContentDesc = Boolean(node.content_desc);
  const hasResourceId = Boolean(node.resource_id);
  const isContainerLike = /(?:FrameLayout|LinearLayout|RelativeLayout|ConstraintLayout|ViewGroup|ViewPager|View)$/i.test(className);

  let score = 0;

  if (hasText) score += 100;
  if (hasContentDesc) score += 90;
  if (hasResourceId) score += 40;
  if (node.scrollable) score += 20;
  if (node.clickable) score += 10;
  if (node.focusable) score += 5;

  if (!hasText && !hasContentDesc && !hasResourceId) {
    score -= 30;
  }
  if (isContainerLike && !hasText && !hasContentDesc) {
    score -= 50;
  }

  return score;
}

function hasIdentifyingField(node) {
  return Boolean(node.text || node.content_desc || node.resource_id);
}

function summarizeNodes(nodes, limit = 25) {
  return nodes
    .map((node, originalIndex) => ({
      originalIndex,
      score: summaryScore(node),
      normalized: normalizeNode(node),
    }))
    .filter((item) => hasIdentifyingField(item.normalized))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map((item) => item.normalized);
}

function extractNodes(dump) {
  if (typeof dump === 'string') {
    const trimmed = dump.trim();
    if (!trimmed.startsWith('<')) {
      return [];
    }
    return parseXmlDump(trimmed);
  }
  if (Array.isArray(dump)) {
    return dump;
  }
  if (Array.isArray(dump?.nodes)) {
    return dump.nodes;
  }
  if (Array.isArray(dump?.data?.nodes)) {
    return dump.data.nodes;
  }
  return [];
}

function anchorFromNode(node) {
  if (node.resource_id) {
    return { resource_id: node.resource_id };
  }
  if (node.content_desc) {
    return { content_desc: node.content_desc };
  }
  if (node.text) {
    return { text: node.text };
  }
  return null;
}

function deriveAnchors(nodes) {
  const anchors = [];
  const seen = new Set();

  for (const node of nodes) {
    const anchor = anchorFromNode(node);
    if (!anchor) {
      continue;
    }
    const key = JSON.stringify(anchor);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    anchors.push(anchor);
  }

  return anchors;
}

function normalizeSnapshot({ packageName, topActivity, dump }) {
  const nodes = extractNodes(dump);
  const normalizedNodes = nodes
    .map(normalizeNode)
    .filter((node) => Object.keys(node).length > 0);

  const activityName = typeof topActivity === 'string'
    ? topActivity
    : topActivity?.activity || topActivity?.class_name || topActivity?.name || null;

  const packageNameValue = packageName
    || topActivity?.package_name
    || topActivity?.packageName
    || null;

  return {
    package_name: packageNameValue,
    top_activity: activityName,
    anchors: deriveAnchors(normalizedNodes),
    key_nodes: summarizeNodes(nodes),
    scrollable_count: normalizedNodes.filter((node) => node.scrollable).length,
  };
}

function anchorKey(anchor) {
  return JSON.stringify(anchor);
}

function matchKnownPage(current, knownPage) {
  const currentAnchorKeys = new Set((current.anchors || []).map(anchorKey));
  const knownAnchors = knownPage.anchors || [];
  const overlap = knownAnchors.filter((anchor) => currentAnchorKeys.has(anchorKey(anchor))).length;
  const score = knownAnchors.length === 0 ? 0 : overlap / knownAnchors.length;
  return { overlap, score };
}

function identifyPage(current, knownPages) {
  const packageMatched = (knownPages || []).filter((page) => page.package_name === current.package_name);
  const candidates = packageMatched
    .map((page) => {
      const { overlap, score } = matchKnownPage(current, page);
      return {
        page_id: page.page_id,
        match_type: overlap === (page.anchors || []).length && overlap > 0 ? 'exact' : (overlap > 0 ? 'similar' : 'unknown'),
        score,
        overlap,
      };
    })
    .sort((left, right) => right.score - left.score || right.overlap - left.overlap);

  const best = candidates[0];
  if (!best || best.overlap === 0) {
    return {
      match_type: 'unknown',
      page_id: null,
      score: 0,
      candidates,
    };
  }

  return {
    match_type: best.match_type,
    page_id: best.page_id,
    score: best.score,
    candidates,
  };
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

module.exports = {
  extractNodes,
  deriveAnchors,
  normalizeSnapshot,
  identifyPage,
  snapshotsEqual,
};
