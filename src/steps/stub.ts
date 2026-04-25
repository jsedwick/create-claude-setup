import type { Phase } from '../state.js';
import type { Step } from './types.js';

export function stubStep(opts: {
  name: string;
  phase: Phase;
  description: string;
  preconditions?: string[];
  skipOn?: string[];
}): Step {
  return {
    name: opts.name,
    phase: opts.phase,
    description: opts.description,
    preconditions: opts.preconditions,
    shouldSkip: (ctx) => {
      if (!opts.skipOn) return false;
      for (const flag of opts.skipOn) {
        if (ctx.skipFlags.has(flag)) return `--${flag}`;
      }
      return false;
    },
    async run(ctx) {
      if (ctx.dryRun) return;
      throw new Error(
        `step ${opts.name} is not yet implemented (Phase 2 scaffold). Use --dry-run.`,
      );
    },
  };
}
