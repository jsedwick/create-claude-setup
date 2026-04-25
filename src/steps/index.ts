import type { Step } from './types.js';
import { detectPlatform } from './detect-platform.js';
import { stubStep } from './stub.js';

export const STEPS: readonly Step[] = [
  detectPlatform,

  stubStep({
    name: 'detect-node',
    phase: 'detect',
    description: 'Compare running Node against engines.node (>=20.0.0)',
  }),
  stubStep({
    name: 'detect-claude-code',
    phase: 'detect',
    description: 'which claude + claude --version (minimum version TBD)',
  }),
  stubStep({
    name: 'detect-existing-install',
    phase: 'detect',
    description: 'Read ~/.claude/setup-state.json; branch into reinstall mode if present',
  }),
  stubStep({
    name: 'detect-existing-mcp-config',
    phase: 'detect',
    description: 'Query Claude Code MCP registry for prior obsidian-mcp-server registration',
  }),

  stubStep({
    name: 'gather-config',
    phase: 'configure',
    description: 'Interactive wizard: mode, vault paths, components, skip flags',
  }),

  stubStep({
    name: 'fetch-mcp-server',
    phase: 'fetch',
    description: 'npm install --prefix ~/.claude/managed/obsidian-mcp-server/',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'fetch-bridge',
    phase: 'fetch',
    description: 'npm install --prefix ~/.claude/managed/claude-chat-bridge/',
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'fetch-plugin',
    phase: 'fetch',
    description: 'Tarball download from GitHub Releases at pinned tag, checksum verified',
    skipOn: ['mcp-only', 'bridge-only'],
  }),

  stubStep({
    name: 'write-mcp-config',
    phase: 'install',
    description: 'Write MCP server config',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'write-trusted-dirs',
    phase: 'install',
    description: 'Write allowed-paths config',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'write-git-commit-watch-list',
    phase: 'install',
    description: 'Write git-commit-watch list config',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'register-mcp-with-claude-code',
    phase: 'install',
    description: 'Atomic JSON write to ~/.claude.json mcpServers key',
    skipOn: ['bridge-only'],
  }),
  stubStep({
    name: 'install-plugin',
    phase: 'install',
    description: 'Hash-compare bundled vs on-disk; install/skip per Decision 015',
    preconditions: ['fetch-plugin', 'register-mcp-with-claude-code'],
    skipOn: ['mcp-only', 'bridge-only'],
  }),
  stubStep({
    name: 'write-plugin-mcp-json-override',
    phase: 'install',
    description: 'Generate live .mcp.json from .mcp.example.json template',
    preconditions: ['install-plugin'],
    skipOn: ['mcp-only', 'bridge-only'],
  }),
  stubStep({
    name: 'write-bridge-config',
    phase: 'install',
    description: 'Write bridge-config.json including resolved serviceLabel',
    preconditions: ['register-mcp-with-claude-code'],
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'generate-https-cert',
    phase: 'install',
    description: 'Generate self-signed cert for bridge HTTPS',
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'trust-https-cert',
    phase: 'install',
    description: 'security add-trusted-cert (may require sudo)',
    preconditions: ['generate-https-cert'],
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'propagate-service-label',
    phase: 'install',
    description: 'Write service label to bridge config and launchd plist env',
    skipOn: ['mcp-only'],
  }),
  stubStep({
    name: 'generate-launchd-plist',
    phase: 'install',
    description: 'launchctl bootstrap gui/$(id -u) <plist>',
    preconditions: ['trust-https-cert', 'propagate-service-label'],
    skipOn: ['mcp-only'],
  }),
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
