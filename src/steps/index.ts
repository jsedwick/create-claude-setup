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
import { stubStep } from './stub.js';

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
  stubStep({
    name: 'write-plugin-mcp-json-override',
    phase: 'install',
    description: 'Generate live .mcp.json from .mcp.example.json template',
    preconditions: ['install-plugin'],
    skipOn: ['mcp-only', 'bridge-only'],
  }),
  writeBridgeConfig,
  generateHttpsCert,
  trustHttpsCert,
  generateLaunchdPlist,
  stubStep({
    name: 'seed-claude-md',
    phase: 'install',
    description: 'Seed ~/.claude/CLAUDE.md starter template (opt-out)',
  }),

  stubStep({
    name: 'verify-mcp-reachable',
    phase: 'verify',
    description: 'Invoke trivial MCP tool or health endpoint',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'verify-bridge-reachable',
    phase: 'verify',
    description: 'HTTPS GET bridge health endpoint with installed cert',
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'verify-plugin-loaded',
    phase: 'verify',
    description: 'Check installed tree structure + hash manifest matches fetched tarball',
    skipOn: ['mcp-only', 'bridge-only'],
  }),
  stubStep({
    name: 'finalize',
    phase: 'verify',
    description: 'Write success marker and print summary',
  }),
];
