import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { PLUGIN_INSTALL_DIR } from '../constants.js';
import type { Step } from './types.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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

export const verifyPluginLoaded: Step = {
  name: 'verify-plugin-loaded',
  phase: 'verify',
  description: 'Verify installed plugin tree matches manifest hashes',
  preconditions: ['install-plugin'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('bridge-only')) return '--bridge-only';
    return false;
  },
  async run(ctx) {
    const root = PLUGIN_INSTALL_DIR;
    const rootStat = await fs.stat(root).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    });
    if (!rootStat || !rootStat.isDirectory()) {
      throw new Error(`${root}: plugin install dir missing — install-plugin did not complete`);
    }

    // manifestPaths may legitimately be empty when every installer-written
    // file has subsequently been user-modified (preserve branch drops the
    // manifest entry). The pluginRoot stat check above already catches the
    // "install-plugin never ran" case, so this is just informational.
    const manifestPaths = Object.keys(ctx.state.fileManifest).filter(
      (p) => p === root || p.startsWith(`${root}/`),
    );

    const corrupted: string[] = [];
    const missing: string[] = [];
    let verified = 0;
    let preserved = 0;

    for (const path of manifestPaths) {
      const expectedHash = ctx.state.fileManifest[path]!;
      let buf: Buffer;
      try {
        buf = await fs.readFile(path);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          missing.push(relative(root, path));
          continue;
        }
        throw err;
      }
      if (sha256(buf) === expectedHash) {
        verified += 1;
      } else {
        corrupted.push(relative(root, path));
      }
    }

    for await (const path of walkFiles(root)) {
      if (ctx.state.fileManifest[path] === undefined) {
        preserved += 1;
      }
    }

    if (missing.length > 0 || corrupted.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`${missing.length} missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
      if (corrupted.length > 0) parts.push(`${corrupted.length} corrupted: ${corrupted.slice(0, 5).join(', ')}${corrupted.length > 5 ? ', …' : ''}`);
      throw new Error(`${root}: ${parts.join('; ')}`);
    }

    ctx.log(`${root}: ${verified} verified, ${preserved} preserved (user-modified)`);
  },
};
