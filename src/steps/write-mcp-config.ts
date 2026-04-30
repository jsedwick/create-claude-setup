import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Mode } from '../state.js';
import type { Step } from './types.js';

const CONFIG_FILENAME = '.obsidian-mcp.json';

interface VaultEntry {
  path: string;
  name: string;
  authority: 'default';
  mode: Mode;
}

interface McpConfig {
  primaryVaults: VaultEntry[];
  secondaryVaults: VaultEntry[];
}

function buildConfig(vaultPaths: Record<string, string>): McpConfig {
  const primaryVaults: VaultEntry[] = [];
  const secondaryVaults: VaultEntry[] = [];
  for (const mode of ['work', 'personal'] as const) {
    const primary = vaultPaths[`${mode}-primary`];
    const secondary = vaultPaths[`${mode}-secondary`];
    if (primary) {
      primaryVaults.push({
        path: primary,
        name: basename(primary),
        authority: 'default',
        mode,
      });
    }
    if (secondary) {
      secondaryVaults.push({
        path: secondary,
        name: basename(secondary),
        authority: 'default',
        mode,
      });
    }
  }
  return { primaryVaults, secondaryVaults };
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

export const writeMcpConfig: Step = {
  name: 'write-mcp-config',
  phase: 'install',
  description: 'Write ~/.obsidian-mcp.json with vault paths from the wizard',
  preconditions: ['fetch-mcp-server'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('bridge-only') ? '--bridge-only' : false,
  async run(ctx) {
    const vaultPaths = ctx.state.config.vaultPaths ?? {};
    if (!vaultPaths['work-primary'] && !vaultPaths['personal-primary']) {
      throw new Error(
        'state.config.vaultPaths has no primary vault — gather-config did not populate state',
      );
    }

    const target = join(homedir(), CONFIG_FILENAME);
    const config = buildConfig(vaultPaths);
    const body = JSON.stringify(config, null, 2) + '\n';
    const newHash = sha256(body);
    const summary = `${config.primaryVaults.length} primary, ${config.secondaryVaults.length} secondary`;

    const existing = await readIfExists(target);
    const recordedHash = ctx.state.fileManifest[target];

    if (existing !== null) {
      const existingHash = sha256(existing);
      if (existingHash === newHash) {
        ctx.state.fileManifest[target] = newHash;
        ctx.log(`${target}: up to date (${summary})`);
        return;
      }
      const installerOwned = recordedHash !== undefined && recordedHash === existingHash;
      if (!installerOwned && !ctx.force) {
        delete ctx.state.fileManifest[target];
        ctx.log(
          `${target}: preserving user-modified file (use --force to overwrite; would write ${summary})`,
        );
        return;
      }
    }

    await atomicWriteFile(target, body);
    ctx.state.fileManifest[target] = newHash;
    ctx.log(`${target}: wrote ${summary}`);
  },
};
