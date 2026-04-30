import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Step } from './types.js';

const BIN_SUBDIR = 'bin';
const LIST_FILENAME = 'git-commit-watch.list';

const DEFAULT_REPOS = [
  '~/Projects/obsidian-mcp-server',
  '~/Projects/claude-chat-bridge',
  '~/Projects/obsidian-claude-plugin',
];

function buildBody(): string {
  return [
    '# git-commit-watch repo list — managed by create-claude-setup.',
    '# One absolute or ~-prefixed repo path per line.',
    '# Blank lines and # comments are ignored. Missing repos are silently skipped.',
    '',
    ...DEFAULT_REPOS,
    '',
  ].join('\n');
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

export const writeGitCommitWatchList: Step = {
  name: 'write-git-commit-watch-list',
  phase: 'install',
  description:
    'Write <plugin-dir>/bin/git-commit-watch.list with default repo paths',
  // Spec table lists precondition `fetch-mcp-server`, but the watcher script
  // requires the list as a sibling file (bin/git-commit-watch.list inside the
  // plugin). The list can only be written after install-plugin extracts the
  // plugin tarball to its final location, so the real precondition is
  // install-plugin. skipOn is widened to mcp-only/bridge-only to match
  // install-plugin (no plugin → nowhere to write the list).
  preconditions: ['install-plugin'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('bridge-only')) return '--bridge-only';
    return false;
  },
  async run(ctx) {
    const pluginPath = ctx.state.components.plugin?.path;
    if (!pluginPath) {
      throw new Error(
        'state.components.plugin.path is missing — install-plugin did not populate state',
      );
    }

    const target = join(pluginPath, BIN_SUBDIR, LIST_FILENAME);
    const body = buildBody();
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
          `${target}: preserving user-modified list (use --force to overwrite)`,
        );
        return;
      }
    }

    await atomicWriteFile(target, body);
    ctx.state.fileManifest[target] = newHash;
    ctx.log(`${target}: wrote ${DEFAULT_REPOS.length} default repo paths`);
  },
};
