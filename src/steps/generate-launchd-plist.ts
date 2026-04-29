import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import type { Step } from './types.js';

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const BRIDGE_ENTRY_REL = join('dist', 'server.js');
const STDOUT_LOG = 'chat-bridge.log';
const STDERR_LOG = 'chat-bridge-error.log';
const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PlistInputs {
  label: string;
  nodeBinary: string;
  entryPath: string;
  workingDir: string;
  home: string;
  envPath: string;
  stdoutPath: string;
  stderrPath: string;
}

function renderPlist(p: PlistInputs): string {
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

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function atomicWriteFile(path: string, body: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o644 });
  await fs.rename(tmp, path);
}

async function isServiceLoaded(domainTarget: string): Promise<boolean> {
  const result = await runCommand('launchctl', ['print', domainTarget]);
  return result.code === 0;
}

export const generateLaunchdPlist: Step = {
  name: 'generate-launchd-plist',
  phase: 'install',
  description:
    'Write LaunchAgent plist for the bridge and load via launchctl bootstrap',
  preconditions: ['trust-https-cert'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('no-launchd')) return '--no-launchd';
    return false;
  },
  async run(ctx) {
    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) {
      throw new Error(
        'state.components.bridge.path is missing — fetch-bridge did not populate state',
      );
    }

    const username = userInfo().username;
    const label = `com.${username}.claude-chat-bridge`;
    const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
    const uid = process.getuid?.() ?? userInfo().uid;
    const userDomain = `gui/${uid}`;
    const domainTarget = `${userDomain}/${label}`;

    const body = renderPlist({
      label,
      nodeBinary: process.execPath,
      entryPath: join(bridgePath, BRIDGE_ENTRY_REL),
      workingDir: bridgePath,
      home: homedir(),
      envPath: DEFAULT_PATH,
      stdoutPath: join(bridgePath, STDOUT_LOG),
      stderrPath: join(bridgePath, STDERR_LOG),
    });
    const newHash = sha256(body);

    const existing = await readIfExists(plistPath);
    const recordedHash = ctx.state.fileManifest[plistPath];

    let didWrite = false;
    if (existing === null) {
      await atomicWriteFile(plistPath, body);
      ctx.state.fileManifest[plistPath] = newHash;
      ctx.log(`${plistPath}: wrote plist (label=${label})`);
      didWrite = true;
    } else {
      const existingHash = sha256(existing);
      if (existingHash === newHash) {
        ctx.state.fileManifest[plistPath] = newHash;
        ctx.log(`${plistPath}: up to date (label=${label})`);
      } else {
        const installerOwned =
          recordedHash !== undefined && recordedHash === existingHash;
        if (installerOwned || ctx.force) {
          await atomicWriteFile(plistPath, body);
          ctx.state.fileManifest[plistPath] = newHash;
          ctx.log(`${plistPath}: wrote plist (label=${label})`);
          didWrite = true;
        } else {
          ctx.log(
            `${plistPath}: preserving user-modified plist (use --force to overwrite)`,
          );
        }
      }
    }

    const loaded = await isServiceLoaded(domainTarget);
    if (didWrite && loaded) {
      const bootout = await runCommand('launchctl', ['bootout', domainTarget]);
      if (bootout.code !== 0) {
        throw new Error(
          `launchctl bootout ${domainTarget} failed (exit ${bootout.code}): ${bootout.stderr.trim() || '(no stderr)'}`,
        );
      }
      ctx.log(`${domainTarget}: booted out (reloading from updated plist)`);
    }
    if (didWrite || !loaded) {
      const bootstrap = await runCommand('launchctl', [
        'bootstrap',
        userDomain,
        plistPath,
      ]);
      if (bootstrap.code !== 0) {
        throw new Error(
          `launchctl bootstrap ${userDomain} ${plistPath} failed (exit ${bootstrap.code}): ${bootstrap.stderr.trim() || '(no stderr)'}`,
        );
      }
      ctx.log(`${domainTarget}: loaded`);
    } else {
      ctx.log(`${domainTarget}: already loaded (no reload needed)`);
    }
  },
};
