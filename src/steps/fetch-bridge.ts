import { join } from 'node:path';
import type { Step } from './types.js';
import {
  BRIDGE_PACKAGE_NAME,
  BRIDGE_PACKAGE_SPEC,
  MANAGED_DIR,
} from '../constants.js';
import { npmInstallToPrefix } from '../npm-install.js';

export const fetchBridge: Step = {
  name: 'fetch-bridge',
  phase: 'fetch',
  description: 'npm install --prefix ~/.claude/managed/claude-chat-bridge/',
  preconditions: ['gather-config'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('mcp-only') ? '--mcp-only' : false,
  async run(ctx) {
    const prefix = join(MANAGED_DIR, BRIDGE_PACKAGE_NAME);
    const result = await npmInstallToPrefix({
      prefix,
      packageName: BRIDGE_PACKAGE_NAME,
      packageSpec: BRIDGE_PACKAGE_SPEC,
      log: ctx.log,
    });
    ctx.state.components.bridge = {
      version: result.installedVersion,
      installedAt: new Date().toISOString(),
      path: result.packagePath,
    };
    ctx.log(`bridge: ${result.installedVersion} → ${result.packagePath}`);
  },
};
