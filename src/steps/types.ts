import type { Phase, SetupState } from '../state.js';

export interface RunContext {
  state: SetupState;
  dryRun: boolean;
  force: boolean;
  skipFlags: Set<string>;
  log: (msg: string) => void;
}

export interface Step {
  name: string;
  phase: Phase;
  description: string;
  preconditions?: string[];
  shouldSkip?: (ctx: RunContext) => boolean | string;
  run: (ctx: RunContext) => Promise<void>;
}
