import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MANAGED_DIR,
  MCP_REGISTRATION_KEY,
  MCP_SERVER_PACKAGE_NAME,
} from '../constants.js';
import type { Step } from './types.js';

const CLAUDE_CONFIG_FILENAME = '.claude.json';
const LOG_FILE = '/tmp/obsidian-mcp-server.log';

interface McpServerEntry {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
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

function buildEntry(): McpServerEntry {
  const packagePath = join(
    MANAGED_DIR,
    MCP_SERVER_PACKAGE_NAME,
    'node_modules',
    MCP_SERVER_PACKAGE_NAME,
  );
  return {
    command: 'node',
    args: [join(packagePath, 'dist', 'index.js')],
    cwd: packagePath,
    env: { LOG_FILE },
  };
}

export const registerMcpWithClaudeCode: Step = {
  name: 'register-mcp-with-claude-code',
  phase: 'install',
  description: `Register ${MCP_REGISTRATION_KEY} in ~/.claude.json mcpServers`,
  preconditions: ['fetch-mcp-server'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('bridge-only') ? '--bridge-only' : false,
  async run(ctx) {
    const target = join(homedir(), CLAUDE_CONFIG_FILENAME);
    const manifestKey = `${target}#mcpServers.${MCP_REGISTRATION_KEY}`;
    const entry = buildEntry();
    const newSlotHash = sha256(canonicalize(entry));

    const raw = await readIfExists(target);
    let parsed: Record<string, unknown>;
    if (raw === null) {
      parsed = {};
    } else {
      let candidate: unknown;
      try {
        candidate = JSON.parse(raw);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${target}: parse error — refusing to overwrite (${msg})`,
        );
      }
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        throw new Error(`${target}: top-level value is not a JSON object`);
      }
      parsed = candidate as Record<string, unknown>;
    }

    const existingMcpServers = parsed.mcpServers;
    if (
      existingMcpServers !== undefined &&
      (existingMcpServers === null ||
        typeof existingMcpServers !== 'object' ||
        Array.isArray(existingMcpServers))
    ) {
      throw new Error(
        `${target}: mcpServers exists but is not an object — refusing to overwrite`,
      );
    }
    const servers =
      (existingMcpServers as Record<string, unknown> | undefined) ?? {};

    const existingSlot = servers[MCP_REGISTRATION_KEY];
    const slotIsCurrent =
      existingSlot !== undefined &&
      sha256(canonicalize(existingSlot)) === newSlotHash;

    if (slotIsCurrent) {
      ctx.state.fileManifest[manifestKey] = newSlotHash;
      ctx.log(`${target}: ${MCP_REGISTRATION_KEY} entry up to date`);
      return;
    }

    servers[MCP_REGISTRATION_KEY] = entry;
    parsed.mcpServers = servers;
    const body = JSON.stringify(parsed, null, 2) + '\n';
    await atomicWriteFile(target, body);
    ctx.state.fileManifest[manifestKey] = newSlotHash;
    ctx.log(
      `${target}: ${existingSlot === undefined ? 'added' : 'updated'} ${MCP_REGISTRATION_KEY} entry`,
    );
  },
};
