import { input, select, checkbox } from '@inquirer/prompts';
import type { Step, RunContext } from './types.js';
import type { Mode, SetupConfig } from '../state.js';

const ALL_COMPONENTS = ['mcp-server', 'bridge', 'plugin'] as const;
type Component = (typeof ALL_COMPONENTS)[number];

const DEFAULT_VAULT_PATHS: Record<string, string> = {
  'work-primary': '~/Documents/Obsidian/AI-Work',
  'work-secondary': '~/Documents/Obsidian/Work',
  'personal-primary': '~/Documents/Obsidian/AI-Home',
  'personal-secondary': '~/Documents/Obsidian/Home',
};

interface CollectedConfig {
  mode: Mode;
  vaultPaths: Record<string, string>;
  components: Component[];
}

function applyComponentSkips(
  components: readonly Component[],
  skipFlags: Set<string>,
): Component[] {
  if (skipFlags.has('mcp-only')) return ['mcp-server'];
  if (skipFlags.has('bridge-only')) return ['bridge'];
  return [...components];
}

function defaults(ctx: RunContext): CollectedConfig {
  const cfg = ctx.state.config;
  const components = applyComponentSkips(
    (cfg.components as Component[] | undefined) ?? ALL_COMPONENTS,
    ctx.skipFlags,
  );
  return {
    mode: ctx.state.mode ?? 'work',
    vaultPaths: { ...DEFAULT_VAULT_PATHS, ...(cfg.vaultPaths ?? {}) },
    components,
  };
}

function isFullyPopulated(state: { mode?: Mode; config: SetupConfig }): boolean {
  if (!state.mode) return false;
  if (!state.config.vaultPaths || !state.config.vaultPaths['work-primary']) return false;
  if (!state.config.vaultPaths['personal-primary']) return false;
  if (!state.config.components || state.config.components.length === 0) return false;
  return true;
}

async function runWizard(ctx: RunContext): Promise<CollectedConfig> {
  const seed = defaults(ctx);

  const mode = await select<Mode>({
    message: 'Default mode',
    choices: [
      { name: 'work', value: 'work' },
      { name: 'personal', value: 'personal' },
    ],
    default: seed.mode,
  });

  const workPrimary = (
    await input({
      message: 'Work mode primary vault path',
      default: seed.vaultPaths['work-primary'],
    })
  ).trim();
  const workSecondary = (
    await input({
      message: 'Work mode secondary vault path (blank for none)',
      default: seed.vaultPaths['work-secondary'] ?? '',
    })
  ).trim();
  const personalPrimary = (
    await input({
      message: 'Personal mode primary vault path',
      default: seed.vaultPaths['personal-primary'],
    })
  ).trim();
  const personalSecondary = (
    await input({
      message: 'Personal mode secondary vault path (blank for none)',
      default: seed.vaultPaths['personal-secondary'] ?? '',
    })
  ).trim();

  const skipForced =
    ctx.skipFlags.has('mcp-only') || ctx.skipFlags.has('bridge-only');
  const components: Component[] = skipForced
    ? seed.components
    : await checkbox<Component>({
        message: 'Components to install',
        choices: ALL_COMPONENTS.map((c) => ({
          name: c,
          value: c,
          checked: seed.components.includes(c),
        })),
        validate: (xs) => xs.length > 0 || 'select at least one component',
      });

  const vaultPaths: Record<string, string> = {
    'work-primary': workPrimary,
    'personal-primary': personalPrimary,
  };
  if (workSecondary) vaultPaths['work-secondary'] = workSecondary;
  if (personalSecondary) vaultPaths['personal-secondary'] = personalSecondary;

  return { mode, vaultPaths, components };
}

function persist(ctx: RunContext, gathered: CollectedConfig): void {
  ctx.state.mode = gathered.mode;
  ctx.state.config.vaultPaths = gathered.vaultPaths;
  ctx.state.config.components = gathered.components;
}

export const gatherConfig: Step = {
  name: 'gather-config',
  phase: 'configure',
  description: 'Interactive wizard: mode, vault paths, components',
  async run(ctx) {
    if (isFullyPopulated(ctx.state)) {
      ctx.log(
        `state.config already populated (mode=${ctx.state.mode}, ` +
          `components=${(ctx.state.config.components ?? []).join(',')}); skipping prompts`,
      );
      return;
    }
    if (ctx.yes) {
      const seed = defaults(ctx);
      ctx.log(
        `--yes: using defaults (mode=${seed.mode}, components=${seed.components.join(',')})`,
      );
      persist(ctx, seed);
      return;
    }
    const gathered = await runWizard(ctx);
    persist(ctx, gathered);
    ctx.log(
      `gathered: mode=${gathered.mode}, components=${gathered.components.join(',')}, ` +
        `${Object.keys(gathered.vaultPaths).length} vault paths`,
    );
  },
};
