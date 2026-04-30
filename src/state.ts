import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const STATE_FILE_PATH = join(homedir(), '.claude', 'setup-state.json');

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export type Phase = 'detect' | 'configure' | 'fetch' | 'install' | 'verify';

export type Mode = 'work' | 'personal';

export interface StepEntry {
  name: string;
  phase: Phase;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ComponentRecord {
  version?: string;
  installedAt?: string;
  path?: string;
  tag?: string;
}

export interface SetupConfig {
  vaultPaths?: Record<string, string>;
  components?: string[];
  skipFlags?: string[];
  pluginTag?: string;
  seedClaudeMd?: boolean;
}

export interface SetupState {
  schemaVersion: number;
  installerVersion: string;
  startedAt: string;
  lastUpdated: string;
  completedAt?: string;
  mode?: Mode;
  config: SetupConfig;
  components: Partial<Record<'mcp-server' | 'bridge' | 'plugin', ComponentRecord>>;
  steps: StepEntry[];
  fileManifest: Record<string, string>;
}

export function newState(installerVersion: string): SetupState {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    installerVersion,
    startedAt: now,
    lastUpdated: now,
    config: {},
    components: {},
    steps: [],
    fileManifest: {},
  };
}

export async function loadState(path: string = STATE_FILE_PATH): Promise<SetupState | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as SetupState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `setup-state.json schema version mismatch: file has ${parsed.schemaVersion}, installer expects ${SCHEMA_VERSION}`,
      );
    }
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveState(
  state: SetupState,
  path: string = STATE_FILE_PATH,
): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const body = JSON.stringify(state, null, 2) + '\n';
  await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o644 });
  await fs.rename(tmp, path);
}

export function findStep(state: SetupState, name: string): StepEntry | undefined {
  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (state.steps[i]!.name === name) return state.steps[i];
  }
  return undefined;
}

export function recordStep(state: SetupState, entry: StepEntry): void {
  state.steps.push(entry);
}
