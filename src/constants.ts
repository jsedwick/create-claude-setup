import { homedir } from 'node:os';
import { join } from 'node:path';

export const MANAGED_DIR = join(homedir(), '.claude', 'managed');
export const STAGING_DIR = join(MANAGED_DIR, '.staging');

export const PLUGINS_DIR = join(homedir(), '.claude', 'plugins');
export const PLUGIN_INSTALL_DIR = join(PLUGINS_DIR, 'obsidian-claude-plugin');
export const PLUGIN_TARBALL_TOPLEVEL = 'obsidian-claude-plugin';

export const MCP_SERVER_PACKAGE_NAME = 'obsidian-mcp-server';
export const MCP_SERVER_PACKAGE_SPEC = 'github:jsedwick/obsidian-mcp-server#main';

export const BRIDGE_PACKAGE_NAME = 'claude-chat-bridge';
export const BRIDGE_PACKAGE_SPEC = 'github:jsedwick/claude-chat-bridge#main';

export const PLUGIN_GITHUB_OWNER = 'jsedwick';
export const PLUGIN_GITHUB_REPO = 'obsidian-claude-plugin';
export const PLUGIN_DEFAULT_TAG = 'v0.1.0';
export const PLUGIN_ASSET_NAME = 'obsidian-claude-plugin.tar.gz';
export const PLUGIN_CHECKSUM_ASSET_NAME = `${PLUGIN_ASSET_NAME}.sha256`;

export function pluginAssetUrl(tag: string, asset: string): string {
  return `https://github.com/${PLUGIN_GITHUB_OWNER}/${PLUGIN_GITHUB_REPO}/releases/download/${tag}/${asset}`;
}
