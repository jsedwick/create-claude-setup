// Standalone smoke test for generate-launchd-plist.
// Exercises plist rendering, file-management decisions, and launchctl probes
// without touching the user's real bridge service.
//
// Run with: node scripts/smoke-launchd-plist.mjs
//
// Requires: dist/ built (npx tsc) so the step module can be imported.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, writeFile, readFile, unlink, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

const SMOKE_LABEL = `com.${userInfo().username}.claude-chat-bridge-smoketest`;
const SMOKE_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${SMOKE_LABEL}.plist`);

let pass = 0;
let fail = 0;

function ok(name) {
  console.log(`  ✓ ${name}`);
  pass++;
}
function bad(name, msg) {
  console.log(`  ✗ ${name}: ${msg}`);
  fail++;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// ---- 1. plutil lint of rendered body ----
console.log('1. Plist validity');

const { renderPlistForSmoke } = await loadHelpers();
const tmpDir = await mkdtemp(join(tmpdir(), 'smoke-plist-'));
const samplePlist = join(tmpDir, 'sample.plist');
const sampleBridge = '/Users/test/.claude/managed/claude-chat-bridge/node_modules/claude-chat-bridge';
const body = renderPlistForSmoke({
  label: SMOKE_LABEL,
  nodeBinary: process.execPath,
  entryPath: join(sampleBridge, 'dist', 'server.js'),
  workingDir: sampleBridge,
  home: homedir(),
  envPath: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  stdoutPath: join(sampleBridge, 'chat-bridge.log'),
  stderrPath: join(sampleBridge, 'chat-bridge-error.log'),
});
await writeFile(samplePlist, body);

const lint = await run('plutil', ['-lint', samplePlist]);
if (lint.code === 0 && lint.stdout.includes('OK')) {
  ok('plutil -lint says OK');
} else {
  bad('plutil -lint', `code=${lint.code} stdout=${lint.stdout.trim()} stderr=${lint.stderr.trim()}`);
}

const parsed = await run('plutil', ['-extract', 'Label', 'raw', samplePlist]);
if (parsed.code === 0 && parsed.stdout.trim() === SMOKE_LABEL) {
  ok(`plutil extracts Label=${SMOKE_LABEL}`);
} else {
  bad('plutil extract Label', `got "${parsed.stdout.trim()}"`);
}

const argsCount = await run('plutil', ['-extract', 'ProgramArguments', 'raw', samplePlist]);
if (argsCount.code === 0 && argsCount.stdout.trim() === '2') {
  ok('ProgramArguments has 2 entries');
} else {
  bad('ProgramArguments size', `got "${argsCount.stdout.trim()}"`);
}

// ---- 2. launchctl probe ----
console.log('2. launchctl probe (isServiceLoaded)');

const { isServiceLoadedForSmoke } = await loadHelpers();
const uid = process.getuid();

// Real live label — should be loaded
const liveLabel = `com.${userInfo().username}.claude-chat-bridge`;
const liveLoaded = await isServiceLoadedForSmoke(`gui/${uid}/${liveLabel}`);
if (liveLoaded) {
  ok(`probe reports live ${liveLabel} loaded`);
} else {
  bad('live probe', 'expected loaded=true (Jesse has it running)');
}

// Bogus label — should not be loaded
const bogusLoaded = await isServiceLoadedForSmoke(`gui/${uid}/${SMOKE_LABEL}-not-real`);
if (!bogusLoaded) {
  ok('probe reports bogus label not loaded');
} else {
  bad('bogus probe', 'expected loaded=false');
}

// ---- 3. File-management branches against a sandbox plist ----
console.log('3. File-management branches');

// Clean any prior smoke plist
try { await unlink(SMOKE_PLIST); } catch {}

const { runStepForSmoke } = await loadHelpers();

// Build a stub state + ctx
function makeState(bridgePath) {
  return {
    schemaVersion: 1,
    installerVersion: '0.0.0-smoke',
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    config: {},
    components: { bridge: { path: bridgePath } },
    steps: [],
    fileManifest: {},
  };
}

// Stage 1: fresh write (no plist exists, no manifest entry)
const sandboxBridge = join(tmpDir, 'fake-bridge');
await fs.mkdir(sandboxBridge, { recursive: true });
const state1 = makeState(sandboxBridge);
const log1 = [];
await runStepForSmoke({
  state: state1, dryRun: false, force: false, yes: true,
  skipFlags: new Set(), log: (m) => log1.push(m),
}, { skipLaunchctl: true, labelOverride: SMOKE_LABEL });

if (await exists(SMOKE_PLIST)) {
  ok('fresh run wrote plist');
} else {
  bad('fresh write', 'plist not on disk');
}
if (state1.fileManifest[SMOKE_PLIST]) {
  ok('fresh run recorded fileManifest hash');
} else {
  bad('fresh write manifest', 'no hash recorded');
}

// Stage 2: idempotent rerun (same content, manifest matches)
const state2 = makeState(sandboxBridge);
state2.fileManifest = { ...state1.fileManifest };
const log2 = [];
await runStepForSmoke({
  state: state2, dryRun: false, force: false, yes: true,
  skipFlags: new Set(), log: (m) => log2.push(m),
}, { skipLaunchctl: true, labelOverride: SMOKE_LABEL });

if (log2.some((l) => l.includes('up to date'))) {
  ok('rerun logs "up to date"');
} else {
  bad('rerun idempotency', `logs: ${log2.join(' | ')}`);
}

// Stage 3: user-modified plist, no --force → preserve
await writeFile(SMOKE_PLIST, '<plist>tampered</plist>\n');
const state3 = makeState(sandboxBridge);
// Intentionally leave fileManifest empty so installerOwned=false
const log3 = [];
await runStepForSmoke({
  state: state3, dryRun: false, force: false, yes: true,
  skipFlags: new Set(), log: (m) => log3.push(m),
}, { skipLaunchctl: true, labelOverride: SMOKE_LABEL });

const onDisk3 = await readFile(SMOKE_PLIST, 'utf8');
if (onDisk3 === '<plist>tampered</plist>\n') {
  ok('user-modified plist preserved without --force');
} else {
  bad('preserve', `file was overwritten: ${onDisk3.slice(0, 60)}`);
}
if (log3.some((l) => l.includes('preserving'))) {
  ok('logs "preserving" message');
} else {
  bad('preserve log', `logs: ${log3.join(' | ')}`);
}

// Stage 4: --force overwrites preserved
const state4 = makeState(sandboxBridge);
const log4 = [];
await runStepForSmoke({
  state: state4, dryRun: false, force: true, yes: true,
  skipFlags: new Set(), log: (m) => log4.push(m),
}, { skipLaunchctl: true, labelOverride: SMOKE_LABEL });

const onDisk4 = await readFile(SMOKE_PLIST, 'utf8');
if (onDisk4.startsWith('<?xml') && onDisk4.includes(SMOKE_LABEL)) {
  ok('--force overwrites preserved plist');
} else {
  bad('force overwrite', `file content: ${onDisk4.slice(0, 80)}`);
}

// ---- 4. Live launchctl bootstrap + bootout cycle ----
console.log('4. Live launchctl bootstrap + bootout');

const liveDomainTarget = `gui/${uid}/${SMOKE_LABEL}`;
const liveUserDomain = `gui/${uid}`;

// Build a no-op plist that runs /bin/sleep so launchd has something live
const sleepPlistBody = renderPlistForSmoke({
  label: SMOKE_LABEL,
  nodeBinary: '/bin/sleep',
  entryPath: '60',
  workingDir: tmpDir,
  home: homedir(),
  envPath: '/usr/bin:/bin',
  stdoutPath: join(tmpDir, 'out.log'),
  stderrPath: join(tmpDir, 'err.log'),
});
await writeFile(SMOKE_PLIST, sleepPlistBody);

// Make sure it's not already loaded from a botched prior run
const preLoaded = await isServiceLoadedForSmoke(liveDomainTarget);
if (preLoaded) {
  await run('launchctl', ['bootout', liveDomainTarget]);
}

const bootstrap = await run('launchctl', ['bootstrap', liveUserDomain, SMOKE_PLIST]);
if (bootstrap.code === 0) {
  ok('launchctl bootstrap succeeded');
} else {
  bad('bootstrap', `code=${bootstrap.code} stderr=${bootstrap.stderr.trim()}`);
}

const loadedAfter = await isServiceLoadedForSmoke(liveDomainTarget);
if (loadedAfter) {
  ok('probe reports smoke service loaded after bootstrap');
} else {
  bad('post-bootstrap probe', 'expected loaded=true');
}

const bootout = await run('launchctl', ['bootout', liveDomainTarget]);
if (bootout.code === 0) {
  ok('launchctl bootout succeeded');
} else {
  bad('bootout', `code=${bootout.code} stderr=${bootout.stderr.trim()}`);
}

const loadedAfterBootout = await isServiceLoadedForSmoke(liveDomainTarget);
if (!loadedAfterBootout) {
  ok('probe reports smoke service unloaded after bootout');
} else {
  bad('post-bootout probe', 'expected loaded=false');
}

// Cleanup
try { await unlink(SMOKE_PLIST); } catch {}
await fs.rm(tmpDir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// ---- helpers loader ----
async function loadHelpers() {
  // The step exports the Step object, but renderPlist/isServiceLoaded are
  // module-private. We re-implement the same logic here so the smoke test
  // can drive each branch in isolation. This mirrors the step file's logic.
  const { generateLaunchdPlist } = await import(join(repoRoot, 'dist', 'steps', 'generate-launchd-plist.js'));

  const { createHash, randomBytes } = await import('node:crypto');
  const { promises: fsp } = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const { dirname } = await import('node:path');

  function xmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderPlistForSmoke(p) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(p.label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(p.nodeBinary)}</string>
        <string>${xmlEscape(p.entryPath)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(p.workingDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xmlEscape(p.envPath)}</string>
        <key>HOME</key>
        <string>${xmlEscape(p.home)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xmlEscape(p.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(p.stderrPath)}</string>
</dict>
</plist>
`;
  }

  function runCmd(cmd, args) {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      proc.stdout?.on('data', (c) => { stdout += c; });
      proc.stderr?.on('data', (c) => { stderr += c; });
      proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  }
  async function isServiceLoadedForSmoke(domainTarget) {
    const r = await runCmd('launchctl', ['print', domainTarget]);
    return r.code === 0;
  }

  // Re-implement the file-management portion of the step's run() with a label override
  // and an option to skip launchctl calls. Mirrors src/steps/generate-launchd-plist.ts.
  async function runStepForSmoke(ctx, opts) {
    const { homedir, userInfo } = await import('node:os');
    const { join, dirname } = await import('node:path');

    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) throw new Error('missing bridge.path');

    const label = opts.labelOverride;
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);

    const body = renderPlistForSmoke({
      label,
      nodeBinary: process.execPath,
      entryPath: join(bridgePath, 'dist', 'server.js'),
      workingDir: bridgePath,
      home: homedir(),
      envPath: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      stdoutPath: join(bridgePath, 'chat-bridge.log'),
      stderrPath: join(bridgePath, 'chat-bridge-error.log'),
    });
    const sha256 = (s) => createHash('sha256').update(s).digest('hex');
    const newHash = sha256(body);

    let existing = null;
    try { existing = await fsp.readFile(plistPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const recordedHash = ctx.state.fileManifest[plistPath];

    let didWrite = false;
    if (existing === null) {
      await fsp.mkdir(dirname(plistPath), { recursive: true });
      const tmp = `${plistPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, body, 'utf8');
      await fsp.rename(tmp, plistPath);
      ctx.state.fileManifest[plistPath] = newHash;
      ctx.log(`${plistPath}: wrote plist (label=${label})`);
      didWrite = true;
    } else {
      const existingHash = sha256(existing);
      if (existingHash === newHash) {
        ctx.state.fileManifest[plistPath] = newHash;
        ctx.log(`${plistPath}: up to date (label=${label})`);
      } else {
        const installerOwned = recordedHash !== undefined && recordedHash === existingHash;
        if (installerOwned || ctx.force) {
          const tmp = `${plistPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
          await fsp.writeFile(tmp, body, 'utf8');
          await fsp.rename(tmp, plistPath);
          ctx.state.fileManifest[plistPath] = newHash;
          ctx.log(`${plistPath}: wrote plist (label=${label})`);
          didWrite = true;
        } else {
          ctx.log(`${plistPath}: preserving user-modified plist (use --force to overwrite)`);
        }
      }
    }

    return { didWrite, plistPath };
  }

  return { renderPlistForSmoke, isServiceLoadedForSmoke, runStepForSmoke, generateLaunchdPlist };
}
