import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import type { Step } from './types.js';

const CONFIG_FILENAME = 'bridge-config.json';
const MCP_CONFIG_PATH = '~/.obsidian-mcp.json';

interface BridgeConfig {
  serviceLabel: string;
  mcpConfigPath: string;
}

function buildConfig(): BridgeConfig {
  return {
    serviceLabel: `com.${userInfo().username}.claude-chat-bridge`,
    mcpConfigPath: MCP_CONFIG_PATH,
  };
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

export const writeBridgeConfig: Step = {
  name: 'write-bridge-config',
  phase: 'install',
  description:
    'Write bridge-config.json with resolved serviceLabel and mcpConfigPath',
  preconditions: ['fetch-bridge'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('mcp-only') ? '--mcp-only' : false,
  async run(ctx) {
    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) {
      throw new Error(
        'state.components.bridge.path is missing — fetch-bridge did not populate state',
      );
    }

    const target = join(bridgePath, CONFIG_FILENAME);
    const config = buildConfig();
    const body = JSON.stringify(config, null, 2) + '\n';
    const newHash = sha256(body);

    const existing = await readIfExists(target);
    const recordedHash = ctx.state.fileManifest[target];

    if (existing !== null) {
      const existingHash = sha256(existing);
      if (existingHash === newHash) {
        ctx.state.fileManifest[target] = newHash;
        ctx.log(`${target}: up to date (serviceLabel=${config.serviceLabel})`);
        return;
      }
      const installerOwned =
        recordedHash !== undefined && recordedHash === existingHash;
      if (!installerOwned && !ctx.force) {
        delete ctx.state.fileManifest[target];
        ctx.log(
          `${target}: preserving user-modified file (use --force to overwrite)`,
        );
        return;
      }
    }

    await atomicWriteFile(target, body);
    ctx.state.fileManifest[target] = newHash;
    ctx.log(`${target}: wrote serviceLabel=${config.serviceLabel}`);
  },
};
