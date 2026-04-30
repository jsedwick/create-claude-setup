import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MCP_REGISTRATION_KEY } from '../constants.js';
import type { Step } from './types.js';

const CLAUDE_CONFIG_FILENAME = '.claude.json';

interface McpServerEntry {
  command?: unknown;
  args?: unknown;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export const verifyMcpReachable: Step = {
  name: 'verify-mcp-reachable',
  phase: 'verify',
  description: 'Verify MCP server is registered and its entrypoint exists on disk',
  preconditions: ['register-mcp-with-claude-code'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('bridge-only') ? '--bridge-only' : false,
  async run(ctx) {
    const target = join(homedir(), CLAUDE_CONFIG_FILENAME);
    const raw = await fs.readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const servers = parsed.mcpServers as Record<string, unknown> | undefined;
    const entry = servers?.[MCP_REGISTRATION_KEY] as McpServerEntry | undefined;
    if (!entry || typeof entry !== 'object') {
      throw new Error(
        `${target}: mcpServers.${MCP_REGISTRATION_KEY} entry missing — register-mcp-with-claude-code did not complete`,
      );
    }

    if (typeof entry.command !== 'string') {
      throw new Error(`${target}: mcpServers.${MCP_REGISTRATION_KEY}.command is not a string`);
    }
    if (!Array.isArray(entry.args) || typeof entry.args[0] !== 'string') {
      throw new Error(
        `${target}: mcpServers.${MCP_REGISTRATION_KEY}.args is missing or malformed`,
      );
    }

    const scriptPath = entry.args[0];
    if (!(await fileExists(scriptPath))) {
      throw new Error(
        `${scriptPath}: MCP entrypoint missing on disk — fetch-mcp-server may have failed`,
      );
    }

    ctx.log(`${MCP_REGISTRATION_KEY}: registered, entrypoint present (${scriptPath})`);
  },
};
