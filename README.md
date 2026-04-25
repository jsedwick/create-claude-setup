# create-claude-setup

Interactive installer for the Claude Code stack:

- [obsidian-mcp-server](https://github.com/jsedwick/obsidian-mcp-server)
- [claude-chat-bridge](https://github.com/jsedwick/claude-chat-bridge)
- [obsidian-claude-plugin](https://github.com/jsedwick/obsidian-claude-plugin)

## Status

**Phase 2 scaffold.** State-machine skeleton present; only `detect-platform` is implemented. All other steps are dry-run stubs.

## Usage

```sh
npx create-claude-setup --dry-run     # walk graph, print plan, no side effects
npx create-claude-setup --help        # list flags
```

## Architecture

- 25-step state machine across 5 phases: Detect (5) → Configure (1) → Fetch (3) → Install (12) → Verify (4)
- Persisted state at `~/.claude/setup-state.json` with atomic temp-file + rename writes
- Resume-on-failure via `--resume` (reads last `failed`/`in_progress` step)
- Install prefix: `~/.claude/managed/`

See vault decisions 013–020 and topic `create-claude-setup-installer-state-machine-step-graph` for design rationale.
