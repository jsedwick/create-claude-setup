import type { Step } from './types.js';
import { detectPlatform } from './detect-platform.js';
import { detectNode } from './detect-node.js';
import { detectClaudeCode } from './detect-claude-code.js';
import { detectExistingInstall } from './detect-existing-install.js';
import { detectExistingMcpConfig } from './detect-existing-mcp-config.js';
import { gatherConfig } from './gather-config.js';
import { fetchMcpServer } from './fetch-mcp-server.js';
import { fetchBridge } from './fetch-bridge.js';
import { fetchPlugin } from './fetch-plugin.js';
import { writeMcpConfig } from './write-mcp-config.js';
import { registerMcpWithClaudeCode } from './register-mcp-with-claude-code.js';
import { writeBridgeConfig } from './write-bridge-config.js';
import { generateHttpsCert } from './generate-https-cert.js';
import { trustHttpsCert } from './trust-https-cert.js';
import { generateLaunchdPlist } from './generate-launchd-plist.js';
import { writeGitCommitWatchList } from './write-git-commit-watch-list.js';
import { installPlugin } from './install-plugin.js';
import { writePluginMcpJsonOverride } from './write-plugin-mcp-json-override.js';
import { seedClaudeMd } from './seed-claude-md.js';
import { verifyMcpReachable } from './verify-mcp-reachable.js';
import { verifyBridgeReachable } from './verify-bridge-reachable.js';
import { verifyPluginLoaded } from './verify-plugin-loaded.js';
import { finalize } from './finalize.js';

export const STEPS: readonly Step[] = [
  detectPlatform,
  detectNode,
  detectClaudeCode,
  detectExistingInstall,
  detectExistingMcpConfig,
  gatherConfig,

  fetchMcpServer,
  fetchBridge,
  fetchPlugin,

  writeMcpConfig,
  registerMcpWithClaudeCode,
  installPlugin,
  writeGitCommitWatchList,
  writePluginMcpJsonOverride,
  writeBridgeConfig,
  generateHttpsCert,
  trustHttpsCert,
  generateLaunchdPlist,
  seedClaudeMd,

  verifyMcpReachable,
  verifyBridgeReachable,
  verifyPluginLoaded,
  finalize,
];
