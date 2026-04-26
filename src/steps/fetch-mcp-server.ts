import { join } from 'node:path';
import type { Step } from './types.js';
import {
  MANAGED_DIR,
  MCP_SERVER_PACKAGE_NAME,
  MCP_SERVER_PACKAGE_SPEC,
} from '../constants.js';
import { npmInstallToPrefix } from '../npm-install.js';

export const fetchMcpServer: Step = {
  name: 'fetch-mcp-server',
  phase: 'fetch',
  description: 'npm install --prefix ~/.claude/managed/obsidian-mcp-server/',
  preconditions: ['gather-config'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('bridge-only') ? '--bridge-only' : false,
  async run(ctx) {
    const prefix = join(MANAGED_DIR, MCP_SERVER_PACKAGE_NAME);
    const result = await npmInstallToPrefix({
      prefix,
      packageName: MCP_SERVER_PACKAGE_NAME,
      packageSpec: MCP_SERVER_PACKAGE_SPEC,
      log: ctx.log,
    });
    ctx.state.components['mcp-server'] = {
      version: result.installedVersion,
      installedAt: new Date().toISOString(),
      path: result.packagePath,
    };
    ctx.log(
      `mcp-server: ${result.installedVersion} → ${result.packagePath}`,
    );
  },
};
