import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { PLUGIN_INSTALL_DIR } from '../constants.js';
import type { Step } from './types.js';

const TEMPLATE_FILENAME = '.mcp.example.json';
const LIVE_FILENAME = '.mcp.json';

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

export const writePluginMcpJsonOverride: Step = {
  name: 'write-plugin-mcp-json-override',
  phase: 'install',
  description:
    'Generate live .mcp.json from .mcp.example.json template per Decision 019',
  preconditions: ['install-plugin'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('bridge-only')) return '--bridge-only';
    return false;
  },
  async run(ctx) {
    const templatePath = join(PLUGIN_INSTALL_DIR, TEMPLATE_FILENAME);
    const target = join(PLUGIN_INSTALL_DIR, LIVE_FILENAME);

    const body = await readIfExists(templatePath);
    if (body === null) {
      throw new Error(
        `${templatePath}: template missing — plugin must ship ${TEMPLATE_FILENAME} per Decision 019`,
      );
    }
    const newHash = sha256(body);

    const existing = await readIfExists(target);
    const recordedHash = ctx.state.fileManifest[target];

    if (existing !== null) {
      const existingHash = sha256(existing);
      if (existingHash === newHash) {
        ctx.state.fileManifest[target] = newHash;
        ctx.log(`${target}: up to date`);
        return;
      }
      const installerOwned =
        recordedHash !== undefined && recordedHash === existingHash;
      if (!installerOwned && !ctx.force) {
        ctx.log(
          `${target}: preserving user-modified file (use --force to overwrite)`,
        );
        return;
      }
    }

    await atomicWriteFile(target, body);
    ctx.state.fileManifest[target] = newHash;
    ctx.log(`${target}: wrote from ${TEMPLATE_FILENAME}`);
  },
};
