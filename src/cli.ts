export interface ParsedArgs {
  help: boolean;
  yes: boolean;
  dryRun: boolean;
  resume: boolean;
  force: boolean;
  skipFlags: Set<string>;
  unknown: string[];
}

const SKIP_FLAGS = new Set(['mcp-only', 'bridge-only', 'no-launchd', 'no-claude-md']);

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    help: false,
    yes: false,
    dryRun: false,
    resume: false,
    force: false,
    skipFlags: new Set(),
    unknown: [],
  };
  for (const arg of argv) {
    switch (arg) {
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--yes':
      case '-y':
        out.yes = true;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--resume':
        out.resume = true;
        break;
      case '--force':
        out.force = true;
        break;
      default: {
        if (arg.startsWith('--') && SKIP_FLAGS.has(arg.slice(2))) {
          out.skipFlags.add(arg.slice(2));
        } else {
          out.unknown.push(arg);
        }
      }
    }
  }
  return out;
}

export const HELP_TEXT = `create-claude-setup — installer for Claude Code + obsidian-mcp-server + claude-chat-bridge

Usage:
  npx create-claude-setup [options]

Options:
  --dry-run        Walk the graph and print the plan; no side effects
  --resume         Resume from the last failed/in-progress step
  --yes, -y        Non-interactive; accept defaults
  --force          Overwrite user-modified files (Decision 015 escape hatch)
  --mcp-only       Install only the MCP server
  --bridge-only    Install only the bridge (requires existing MCP)
  --no-launchd     Skip the LaunchAgent plist install (bridge stays manually-run)
  --no-claude-md   Skip seeding ~/.claude/CLAUDE.md starter template
  --help, -h       Show this message

State is persisted at ~/.claude/setup-state.json.
`;
