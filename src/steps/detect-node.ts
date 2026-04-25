import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Step } from './types.js';

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(raw: string): SemverParts {
  const core = raw.replace(/^v/, '').split(/[-+]/, 1)[0]!;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(core);
  if (!m) throw new Error(`unparseable semver: "${raw}"`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function gte(a: SemverParts, b: SemverParts): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

interface ParsedRange {
  operator: '>=';
  version: SemverParts;
}

function parseRange(spec: string): ParsedRange {
  const trimmed = spec.trim();
  const m = /^>=\s*(.+)$/.exec(trimmed);
  if (!m) {
    throw new Error(
      `unsupported engines.node range "${spec}". detect-node currently only handles ">=X.Y.Z".`,
    );
  }
  return { operator: '>=', version: parseSemver(m[1]!) };
}

async function readEnginesNode(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', 'package.json');
  const raw = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { engines?: { node?: string } };
  const spec = pkg.engines?.node;
  if (!spec) throw new Error(`installer package.json is missing engines.node`);
  return spec;
}

export const detectNode: Step = {
  name: 'detect-node',
  phase: 'detect',
  description: 'Compare running Node against engines.node',
  async run(ctx) {
    const spec = await readEnginesNode();
    const range = parseRange(spec);
    const running = parseSemver(process.versions.node);
    ctx.log(`node: v${process.versions.node} (required ${spec})`);
    if (!gte(running, range.version)) {
      throw new Error(
        `Node v${process.versions.node} is below required ${spec}. ` +
          `Install Node ${range.version.major}+ (https://nodejs.org or via nvm/fnm/asdf) and re-run with --resume.`,
      );
    }
  },
};
