import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Step } from './types.js';
import {
  PLUGIN_ASSET_NAME,
  PLUGIN_CHECKSUM_ASSET_NAME,
  PLUGIN_DEFAULT_TAG,
  STAGING_DIR,
  pluginAssetUrl,
} from '../constants.js';

function parseSha256Sidecar(text: string): string {
  const m = /^([0-9a-fA-F]{64})\b/.exec(text.trim());
  if (!m) {
    throw new Error(
      `unparseable sha256 sidecar (no 64-hex token): ${JSON.stringify(text)}`,
    );
  }
  return m[1]!.toLowerCase();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.text();
}

async function downloadAndHash(url: string, destPartial: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  if (!res.body) {
    throw new Error(`empty response body for ${url}`);
  }
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const body = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  await pipeline(body, tap, createWriteStream(destPartial));
  return hash.digest('hex');
}

export const fetchPlugin: Step = {
  name: 'fetch-plugin',
  phase: 'fetch',
  description:
    'Download plugin tarball from GitHub Releases at pinned tag, sha256 verified',
  preconditions: ['gather-config'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('bridge-only')) return '--bridge-only';
    return false;
  },
  async run(ctx) {
    const tag = ctx.state.config.pluginTag ?? PLUGIN_DEFAULT_TAG;
    ctx.state.config.pluginTag = tag;

    const tarballUrl = pluginAssetUrl(tag, PLUGIN_ASSET_NAME);
    const checksumUrl = pluginAssetUrl(tag, PLUGIN_CHECKSUM_ASSET_NAME);
    ctx.log(`tag: ${tag}`);
    ctx.log(`tarball: ${tarballUrl}`);

    await mkdir(STAGING_DIR, { recursive: true });
    const stagedPath = join(STAGING_DIR, `obsidian-claude-plugin-${tag}.tar.gz`);
    const partial = `${stagedPath}.partial`;

    let expected: string;
    try {
      expected = parseSha256Sidecar(await fetchText(checksumUrl));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to fetch sha256 sidecar: ${msg}`);
    }

    let actual: string;
    try {
      actual = await downloadAndHash(tarballUrl, partial);
    } catch (err) {
      await rm(partial, { force: true });
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to download tarball: ${msg}`);
    }

    if (actual !== expected) {
      await rm(partial, { force: true });
      throw new Error(
        `sha256 mismatch: expected ${expected}, got ${actual}`,
      );
    }

    await rename(partial, stagedPath);

    ctx.state.components.plugin = {
      tag,
      installedAt: new Date().toISOString(),
      path: stagedPath,
    };
    ctx.log(`plugin: ${tag} (sha256 ✓) → ${stagedPath}`);
  },
};
