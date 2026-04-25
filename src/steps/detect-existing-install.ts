import type { Step } from './types.js';
import { findStep } from '../state.js';

const COMPONENT_KEYS = ['mcp-server', 'bridge', 'plugin'] as const;

export const detectExistingInstall: Step = {
  name: 'detect-existing-install',
  phase: 'detect',
  description: 'Inspect setup-state.json for prior-install artifacts',
  async run(ctx) {
    const installed = COMPONENT_KEYS.filter(
      (key) => ctx.state.components[key]?.installedAt,
    );
    const finalize = findStep(ctx.state, 'finalize');
    const finalized = finalize?.status === 'completed';

    if (finalized) {
      ctx.log(
        `prior install completed (installerVersion ${ctx.state.installerVersion}); ` +
          `reinstall mode — Decision 015 file-preservation applies`,
      );
      return;
    }
    if (installed.length > 0) {
      ctx.log(
        `partial prior install detected (components recorded: ${installed.join(', ')}); ` +
          `reinstall mode — Decision 015 file-preservation applies`,
      );
      return;
    }
    ctx.log('no prior install detected — fresh install');
  },
};
