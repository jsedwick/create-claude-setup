import type { Step } from './types.js';

export const finalize: Step = {
  name: 'finalize',
  phase: 'verify',
  description: 'Mark setup complete and print install summary',
  async run(ctx) {
    ctx.state.completedAt = new Date().toISOString();

    const { components, fileManifest } = ctx.state;
    const fileCount = Object.keys(fileManifest).length;

    const lines: string[] = [];
    lines.push('');
    lines.push('Setup complete.');
    lines.push('');
    lines.push('Components installed:');
    for (const [key, record] of Object.entries(components)) {
      if (!record) continue;
      const version = record.tag ?? record.version ?? '?';
      const path = record.path ?? '?';
      lines.push(`  ${key.padEnd(12)} ${version.padEnd(10)} ${path}`);
    }
    lines.push('');
    lines.push(`Files managed: ${fileCount}`);
    lines.push('');
    lines.push('Next steps:');
    lines.push('  • Restart Claude Code to load the registered MCP server');
    lines.push('  • Run /vault:work or /vault:personal to switch modes');
    lines.push('  • Edit ~/.claude/CLAUDE.md to customize global instructions');

    for (const line of lines) ctx.log(line);
  },
};
