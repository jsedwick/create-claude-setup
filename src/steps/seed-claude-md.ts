import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Step } from './types.js';

const TARGET_FILENAME = 'CLAUDE.md';

const STARTER_TEMPLATE = `# CLAUDE.md

This file is loaded as global instructions in every Claude Code session.
Customize it with your role, preferences, persona, or other context you want
Claude to have across all your projects.

## My Instructions

<!-- Add your customizations here -->
`;

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

export const seedClaudeMd: Step = {
  name: 'seed-claude-md',
  phase: 'install',
  description: 'Seed ~/.claude/CLAUDE.md starter template (opt-out via --no-claude-md)',
  preconditions: ['gather-config'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('no-claude-md') ? '--no-claude-md' : false,
  async run(ctx) {
    const target = join(homedir(), '.claude', TARGET_FILENAME);
    const body = STARTER_TEMPLATE;
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
        delete ctx.state.fileManifest[target];
        ctx.log(
          `${target}: preserving user-modified file (use --force to overwrite)`,
        );
        return;
      }
    }

    await atomicWriteFile(target, body);
    ctx.state.fileManifest[target] = newHash;
    ctx.log(`${target}: wrote starter template`);
  },
};
