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
  yes: boolean;
  skipFlags: Set<string>;
  statePath?: string;
}

function validateStepGraph(steps: readonly Step[]): void {
  const indexByName = new Map<string, number>();
  steps.forEach((s, i) => indexByName.set(s.name, i));
  const errors: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!step.preconditions || step.preconditions.length === 0) continue;
    for (const dep of step.preconditions) {
      const depIndex = indexByName.get(dep);
      if (depIndex === undefined) {
        errors.push(`step "${step.name}" declares unknown precondition "${dep}"`);
      } else if (depIndex >= i) {
        errors.push(
          `step "${step.name}" (index ${i}) declares precondition "${dep}" (index ${depIndex}) that does not come earlier in the step list`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`step graph validation failed:\n  ${errors.join('\n  ')}`);
  }
}

function unsatisfiedPreconditions(state: SetupState, step: Step): string[] {
  if (!step.preconditions || step.preconditions.length === 0) return [];
  const missing: string[] = [];
  for (const dep of step.preconditions) {
    const entry = findStep(state, dep);
    if (!entry || entry.status !== 'completed') {
      missing.push(dep);
    }
  }
  return missing;
}

export async function runPipeline(
  steps: readonly Step[],
  state: SetupState,
  opts: RunnerOptions,
): Promise<{ ok: boolean; failedAt?: string }> {
  validateStepGraph(steps);

  const log = (msg: string) => process.stdout.write(`${msg}\n`);
  const ctx = {
    state,
    dryRun: opts.dryRun,
    force: opts.force,
    yes: opts.yes,
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

    const missing = unsatisfiedPreconditions(state, step);
    if (missing.length > 0) {
      const error = `preconditions not completed: ${missing.join(', ')}`;
      const now = new Date().toISOString();
      recordStep(state, {
        name: step.name,
        phase: step.phase,
        status: 'failed',
        startedAt: now,
        completedAt: now,
        error,
      });
      await saveState(state, opts.statePath);
      log(`✗ ${step.name}: ${error}`);
      return { ok: false, failedAt: step.name };
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
