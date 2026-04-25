import type { Step } from './steps/types.js';
import {
  type SetupState,
  findStep,
  recordStep,
  saveState,
} from './state.js';

export interface RunnerOptions {
  dryRun: boolean;
  force: boolean;
  resume: boolean;
  skipFlags: Set<string>;
  statePath?: string;
}

export async function runPipeline(
  steps: readonly Step[],
  state: SetupState,
  opts: RunnerOptions,
): Promise<{ ok: boolean; failedAt?: string }> {
  const log = (msg: string) => process.stdout.write(`${msg}\n`);
  const ctx = {
    state,
    dryRun: opts.dryRun,
    force: opts.force,
    skipFlags: opts.skipFlags,
    log,
  };

  for (const step of steps) {
    const prior = findStep(state, step.name);
    if (!opts.dryRun && opts.resume && prior?.status === 'completed') {
      log(`✓ ${step.name} (skipped: already completed)`);
      continue;
    }

    const skipReason = step.shouldSkip?.(ctx);
    if (skipReason) {
      const reason = typeof skipReason === 'string' ? skipReason : 'skipped';
      log(`⊘ ${step.name} (${reason})`);
      if (!opts.dryRun) {
        recordStep(state, {
          name: step.name,
          phase: step.phase,
          status: 'skipped',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        await saveState(state, opts.statePath);
      }
      continue;
    }

    if (opts.dryRun) {
      const tag = `[${step.phase}]`.padEnd(11);
      log(`${tag} ${step.name} — ${step.description}`);
      continue;
    }

    const startedAt = new Date().toISOString();
    recordStep(state, {
      name: step.name,
      phase: step.phase,
      status: 'in_progress',
      startedAt,
    });
    await saveState(state, opts.statePath);

    log(`▶ ${step.name} — ${step.description}`);
    try {
      await step.run(ctx);
      const last = state.steps[state.steps.length - 1]!;
      last.status = 'completed';
      last.completedAt = new Date().toISOString();
      await saveState(state, opts.statePath);
      log(`✓ ${step.name}`);
    } catch (err: unknown) {
      const last = state.steps[state.steps.length - 1]!;
      last.status = 'failed';
      last.completedAt = new Date().toISOString();
      last.error = err instanceof Error ? err.message : String(err);
      await saveState(state, opts.statePath);
      log(`✗ ${step.name}: ${last.error}`);
      return { ok: false, failedAt: step.name };
    }
  }

  return { ok: true };
}
