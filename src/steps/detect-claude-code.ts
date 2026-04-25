import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Step } from './types.js';

const execFileAsync = promisify(execFile);

interface ClaudeVersion {
  version: string;
  raw: string;
}

async function detectClaudeBinary(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', ['claude']);
    const path = stdout.trim();
    if (!path) {
      throw new Error(`"claude" not found on PATH.`);
    }
    return path;
  } catch {
    throw new Error(
      `"claude" not found on PATH. Install Claude Code (https://claude.com/claude-code) and re-run with --resume.`,
    );
  }
}

async function readClaudeVersion(): Promise<ClaudeVersion> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('claude', ['--version'], { timeout: 10_000 }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to invoke "claude --version": ${msg}`);
  }
  const raw = stdout.trim();
  // Observed format: "2.1.87 (Claude Code)" — leading X.Y.Z token.
  const m = /^(\d+\.\d+\.\d+)/.exec(raw);
  if (!m) {
    throw new Error(
      `unexpected output from "claude --version": ${JSON.stringify(raw)}`,
    );
  }
  return { version: m[1]!, raw };
}

export const detectClaudeCode: Step = {
  name: 'detect-claude-code',
  phase: 'detect',
  description: 'Locate `claude` binary and parse version (no minimum gate yet)',
  async run(ctx) {
    const path = await detectClaudeBinary();
    const { version, raw } = await readClaudeVersion();
    ctx.log(`claude: ${path}`);
    ctx.log(`claude --version: ${raw} → ${version}`);
  },
};
