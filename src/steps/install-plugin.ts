import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  PLUGIN_INSTALL_DIR,
  PLUGIN_TARBALL_TOPLEVEL,
  STAGING_DIR,
} from '../constants.js';
import type { Step } from './types.js';

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

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function atomicWriteFile(
  path: string,
  body: Buffer,
  mode: number,
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, body, { mode });
  await fs.chmod(tmp, mode);
  await fs.rename(tmp, path);
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export const installPlugin: Step = {
  name: 'install-plugin',
  phase: 'install',
  description:
    'Extract plugin tarball into ~/.claude/plugins/obsidian-claude-plugin per Decision 015',
  preconditions: ['fetch-plugin', 'register-mcp-with-claude-code'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('bridge-only')) return '--bridge-only';
    return false;
  },
  async run(ctx) {
    const tag = ctx.state.config.pluginTag;
    if (!tag) {
      throw new Error(
        'state.config.pluginTag is missing — fetch-plugin did not populate state',
      );
    }
    const tarballPath = join(STAGING_DIR, `obsidian-claude-plugin-${tag}.tar.gz`);
    const tarballStat = await fs.stat(tarballPath).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    });
    if (!tarballStat) {
      throw new Error(
        `plugin tarball missing at ${tarballPath} — re-run fetch-plugin (or use --resume after deletion)`,
      );
    }

    await fs.mkdir(STAGING_DIR, { recursive: true });
    const extractDir = join(STAGING_DIR, `extract-${randomBytes(4).toString('hex')}`);
    await fs.mkdir(extractDir, { recursive: true });

    try {
      const tarRes = await runCommand('tar', ['-xzf', tarballPath, '-C', extractDir]);
      if (tarRes.code !== 0) {
        throw new Error(
          `tar -xzf ${tarballPath} failed (exit ${tarRes.code}): ${tarRes.stderr.trim() || '(no stderr)'}`,
        );
      }

      const topLevelEntries = await fs.readdir(extractDir, { withFileTypes: true });
      const expected = topLevelEntries.find(
        (e) => e.isDirectory() && e.name === PLUGIN_TARBALL_TOPLEVEL,
      );
      if (!expected) {
        throw new Error(
          `unexpected tarball structure: expected single top-level dir "${PLUGIN_TARBALL_TOPLEVEL}/", got ${topLevelEntries.map((e) => e.name).join(', ') || '(empty)'}`,
        );
      }
      const pluginRoot = join(extractDir, PLUGIN_TARBALL_TOPLEVEL);

      let installed = 0;
      let upToDate = 0;
      let preserved = 0;

      for await (const srcPath of walkFiles(pluginRoot)) {
        const rel = relative(pluginRoot, srcPath);
        const target = join(PLUGIN_INSTALL_DIR, rel);
        const srcStat = await fs.stat(srcPath);
        const srcBuf = await fs.readFile(srcPath);
        const newHash = sha256(srcBuf);

        const existing = await readIfExists(target);
        const recordedHash = ctx.state.fileManifest[target];

        if (existing === null) {
          await atomicWriteFile(target, srcBuf, srcStat.mode & 0o777);
          ctx.state.fileManifest[target] = newHash;
          installed += 1;
          continue;
        }

        const existingHash = sha256(existing);
        if (existingHash === newHash) {
          ctx.state.fileManifest[target] = newHash;
          upToDate += 1;
          continue;
        }

        const installerOwned =
          recordedHash !== undefined && recordedHash === existingHash;
        if (installerOwned || ctx.force) {
          await atomicWriteFile(target, srcBuf, srcStat.mode & 0o777);
          ctx.state.fileManifest[target] = newHash;
          installed += 1;
        } else {
          ctx.log(`${target}: preserving user-modified file (use --force to overwrite)`);
          preserved += 1;
        }
      }

      ctx.state.components.plugin = {
        ...(ctx.state.components.plugin ?? {}),
        tag,
        installedAt: new Date().toISOString(),
        path: PLUGIN_INSTALL_DIR,
      };

      ctx.log(
        `${PLUGIN_INSTALL_DIR}: ${installed} installed, ${upToDate} up to date, ${preserved} preserved`,
      );
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true });
    }
  },
};
