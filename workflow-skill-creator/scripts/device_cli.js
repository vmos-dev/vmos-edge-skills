#!/usr/bin/env node
'use strict';

const { parseArgs } = require('./utils');

const COMMANDS = {
  act: 'Execute an action without recording (same format as walk --action)',
  launch: 'Launch an app by package name',
  key: 'Send a key event (HOME=3, BACK=4)',
  scroll: 'Scroll using bezier gesture without recording a step',
  packages: 'List installed packages (find package_name for launch)',
  snapshot: 'Visible-area accessibility dump with hierarchy (package, activity, elements)',
  'identify-page': 'Match current screen against saved page snapshots',
  probe: 'Post-recording verification: blind execute action and check result (before/action/after)',
};

const COMMAND_HELP = {
  scroll: `Usage: scroll [options]

Scroll on screen using bezier gesture. Does not record a step.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)
  --direction <dir>         Scroll direction: up, down, left, right

Optional:
  --bounds <json>           Container bounds to scroll within, e.g. '{"left":0,"top":400,"right":1080,"bottom":2000}'
  --distance <number>       Scroll distance in pixels (default: 500)`,

  act: `Usage: act [options]

Perform an action without recording. Same --action format as walk.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)
  --action <json>           Action JSON, e.g. {"path":"accessibility/node","params":{"selector":{"text":"<label>"},"action":"click"}}`,

  launch: `Usage: launch [options]

Launch an app by package name.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)
  --package <name>          Android package name to launch`,

  key: `Usage: key [options]

Send a key event (HOME=3, BACK=4).

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)
  --code <number>           Key event code (e.g. 3 for HOME, 4 for BACK)`,

  packages: `Usage: packages [options]

List installed packages on device. Useful to discover package_name for launch.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)

Optional:
  --type <type>             "all", "system", or "user" (default: "user")`,

  snapshot: `Usage: snapshot [options]

Visible-area accessibility dump with hierarchy. Shows all elements
currently on screen with their attributes (text, resource_id, content_desc,
bounds, clickable, etc.) in an indented tree structure.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)`,

  'identify-page': `Usage: identify-page [options]

Identify the current page against saved page snapshots.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)

Optional:
  --dir <path>              Workspace directory (defaults to cwd)`,

  probe: `Usage: probe [options]

Post-recording verification: execute action blindly and verify result.
Takes a before-snapshot, executes the action, takes an after-snapshot,
then checks verify-selector. Proves the step works without human observation.

Required:
  --base-url <url>          Device API URL (or set WORKFLOW_BASE_URL)
  --action <json>           Action to execute (same format as walk --action)

Optional:
  --verify-selector <json>  Element selector to verify after action
  --expected-page <id>      Expected page ID after action`,

};

function parseJsonArg(value, label) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for ${label}: ${error.message}`);
  }
}

async function buildSnapshot(args, { deviceApi, pageSnapshot }) {
  const baseUrl = args['base-url'] || process.env.WORKFLOW_BASE_URL;
  const dump = await deviceApi.dump(baseUrl);

  let topActivity = null;
  try {
    topActivity = await deviceApi.topActivity(baseUrl);
  } catch (_error) {
    topActivity = null;
  }

  return pageSnapshot.normalizeSnapshot({
    packageName: topActivity?.package_name || topActivity?.packageName || null,
    topActivity,
    dump,
  });
}

async function identifyCurrentPage(args, deps) {
  const { authoringWorkspace, pageSnapshot } = deps;
  const snapshot = await buildSnapshot(args, deps);
  const knownPages = authoringWorkspace.loadPages(args.dir || process.cwd());
  return pageSnapshot.identifyPage(snapshot, knownPages);
}

function createProbeDevice(baseUrl, deviceApi) {
  return {
    runWorkflowStep: async (step) => deviceApi.runWorkflowStep(baseUrl, step),
  };
}

async function runProbeCommand(args, deps) {
  const { probe } = deps;
  const baseUrl = args['base-url'] || process.env.WORKFLOW_BASE_URL;
  const action = parseJsonArg(args.action || args['action-json'], '--action');
  if (!action) {
    throw new Error('probe requires --action');
  }

  const verifySelector = parseJsonArg(args['verify-selector'], '--verify-selector');
  const expectedPageId = args['expected-page'] || null;
  const device = createProbeDevice(baseUrl, deps.deviceApi);

  return probe.runProbe({
    action,
    device,
    verifySelector,
    expectedPageId,
    waitDelaysMs: [1000, 2000, 3000],
    snapshotProvider: () => buildSnapshot(args, deps),
  });
}

async function runLegacyCommand(command, args, { deviceApi }) {
  const baseUrl = args['base-url'] || process.env.WORKFLOW_BASE_URL;

  switch (command) {
    case 'act': {
      // Same format as walk: --action '{"path":"accessibility/node","params":{"selector":{...},"action":"click"}}'
      const parsed = parseJsonArg(args.action, '--action');
      if (!parsed || !parsed.path || !parsed.params) {
        throw new Error('act requires --action JSON with path and params (same format as walk)');
      }
      const p = parsed.params;
      return deviceApi.actOnNode(baseUrl, p.selector, p.action || 'click', p);
    }

    case 'launch':
      if (!args.package) {
        throw new Error('launch requires --package');
      }
      return deviceApi.launchApp(baseUrl, args.package);

    case 'key': {
      const code = parseInt(args.code, 10);
      if (Number.isNaN(code)) {
        throw new Error('key requires --code');
      }
      return deviceApi.keyEvent(baseUrl, code);
    }

    case 'scroll': {
      const VALID_DIRECTIONS = ['up', 'down', 'left', 'right'];
      if (!args.direction || !VALID_DIRECTIONS.includes(args.direction)) {
        throw new Error(`scroll requires --direction (${VALID_DIRECTIONS.join('/')})`);
      }
      const bounds = args.bounds ? parseJsonArg(args.bounds, '--bounds') : undefined;
      const distance = args.distance ? parseInt(args.distance, 10) : undefined;
      let screenSize = null;
      try { screenSize = await deviceApi.displayInfo(baseUrl); } catch (_) { /* use defaults */ }
      return deviceApi.scrollBezier(baseUrl, {
        direction: args.direction,
        bounds,
        distance,
        screenSize,
      });
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}


async function runCommand(command, args, deps = {}) {
  const deviceApi = deps.deviceApi || require('./device_api');
  const pageSnapshot = deps.pageSnapshot || require('./page_snapshot');
  const authoringWorkspace = deps.authoringWorkspace || require('./authoring_workspace');
  const probe = deps.probe || require('./probe');
  const baseUrl = args['base-url'] || process.env.WORKFLOW_BASE_URL;

  if (!baseUrl) {
    throw new Error('--base-url is required (or set WORKFLOW_BASE_URL)');
  }

  const injectedDeps = {
    deviceApi,
    pageSnapshot,
    authoringWorkspace,
    probe,
  };

  switch (command) {
    case 'packages': {
      const type = args.type || 'user';
      return deviceApi.listPackages(baseUrl, type);
    }
    case 'snapshot': {
      const [compact, activity] = await Promise.all([
        deviceApi.dumpCompact(baseUrl),
        deviceApi.topActivity(baseUrl).catch(() => null),
      ]);
      return {
        package_name: activity?.package_name || null,
        top_activity: activity?.class_name || null,
        dump: compact,
      };
    }
    case 'identify-page':
      return identifyCurrentPage(args, injectedDeps);
    case 'probe':
      return runProbeCommand(args, injectedDeps);
    default:
      return runLegacyCommand(command, args, injectedDeps);
  }
}

function printUsage() {
  console.log('Usage: node scripts/device_cli.js <command> --base-url <url> [options]\n');
  console.log('Commands:');
  for (const [command, description] of Object.entries(COMMANDS)) {
    console.log(`  ${command.padEnd(16)} ${description}`);
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
  const result = await runCommand(command, args);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  COMMANDS,
  COMMAND_HELP,
  runCommand,
  main,
};
