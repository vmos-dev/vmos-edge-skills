#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const target = process.argv[2] ?? '@vmosedge/cli'
const cliCommand = process.platform === 'win32' ? 'vmos-edge-cli.cmd' : 'vmos-edge-cli'
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)

if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
  console.error(`Node.js 18+ is required. Current version: ${process.versions.node}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  })
}

function cliStatus() {
  const result = run(cliCommand, ['--version'])
  if (result.error?.code === 'ENOENT') return { installed: false }
  if (result.error) return { installed: true, healthy: false, detail: result.error.message }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim()
    return { installed: true, healthy: false, detail }
  }
  return { installed: true, healthy: true, version: result.stdout.trim() }
}

function npmStatus() {
  const result = run(npmCommand, ['--version'])
  if (result.error?.code === 'ENOENT') return { available: false }
  if (result.error) return { available: false, detail: result.error.message }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim()
    return { available: false, detail }
  }
  return { available: true, version: result.stdout.trim() }
}

function verifySchema() {
  const result = run(cliCommand, ['schema'])
  if (result.error) return { ok: false, detail: result.error.message }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim()
    return { ok: false, detail }
  }
  return { ok: true }
}

const status = cliStatus()

if (status.installed && status.healthy) {
  console.log(
    status.version
      ? `vmos-edge-cli already installed (${status.version})`
      : 'vmos-edge-cli already installed'
  )
  process.exit(0)
}

if (status.installed && !status.healthy) {
  console.error(`vmos-edge-cli is installed but unhealthy: ${status.detail}`)
  process.exit(1)
}

const npm = npmStatus()
if (!npm.available) {
  const detail = npm.detail || 'npm command not found'
  console.error(`npm is required to install vmos-edge-cli: ${detail}`)
  process.exit(1)
}

console.error(`vmos-edge-cli not found; installing with npm install -g ${target}`)
const installResult = spawnSync(npmCommand, ['install', '-g', target], {
  stdio: 'inherit',
})

if (installResult.error) {
  console.error(`npm install failed: ${installResult.error.message}`)
  process.exit(1)
}

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1)
}

const installedStatus = cliStatus()
if (!installedStatus.installed || !installedStatus.healthy) {
  const detail = installedStatus.detail || 'command is still unavailable after npm install'
  console.error(`vmos-edge-cli install verification failed: ${detail}`)
  process.exit(1)
}

const schemaCheck = verifySchema()
if (!schemaCheck.ok) {
  console.error(`vmos-edge-cli installed but schema check failed: ${schemaCheck.detail}`)
  process.exit(1)
}

console.log(
  installedStatus.version
    ? `vmos-edge-cli installed successfully (${installedStatus.version})`
    : 'vmos-edge-cli installed successfully'
)
