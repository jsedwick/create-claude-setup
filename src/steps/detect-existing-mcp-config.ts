import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MCP_REGISTRATION_KEY } from '../constants.js';
import type { Step } from './types.js';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
}

export const detectExistingMcpConfig: Step = {
  name: 'detect-existing-mcp-config',
  phase: 'detect',
  description: `Inspect ~/.claude.json for prior ${MCP_REGISTRATION_KEY} registration`,
  async run(ctx) {
    let raw: string;
    try {
      raw = await readFile(CLAUDE_CONFIG_PATH, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.log(`~/.claude.json not found — Claude Code has not been launched yet`);
        return;
      }
      throw err;
    }

    let parsed: ClaudeConfig;
    try {
      parsed = JSON.parse(raw) as ClaudeConfig;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `~/.claude.json is not valid JSON (${msg}). Fix the file or remove it before re-running.`,
      );
    }

    const existing = parsed.mcpServers?.[MCP_REGISTRATION_KEY];
    if (existing) {
      ctx.log(
        `existing ${MCP_REGISTRATION_KEY} registration found in ~/.claude.json — ` +
          `wizard will prompt before overwriting`,
      );
    } else {
      ctx.log(`no ${MCP_REGISTRATION_KEY} registration in ~/.claude.json — clean slate`);
    }
  },
};
