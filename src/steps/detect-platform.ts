import type { Step } from './types.js';

export const detectPlatform: Step = {
  name: 'detect-platform',
  phase: 'detect',
  description: 'Assert process.platform === "darwin"; hard-fail otherwise',
  async run(ctx) {
    const plat = process.platform;
    ctx.log(`platform: ${plat} (${process.arch})`);
    if (plat !== 'darwin') {
      throw new Error(
        `unsupported platform: ${plat}. create-claude-setup currently supports macOS only (darwin).`,
      );
    }
  },
};
