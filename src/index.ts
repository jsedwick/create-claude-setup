#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HELP_TEXT, parseArgs } from './cli.js';
import { STEPS } from './steps/index.js';
import { loadState, newState, saveState } from './state.js';
import { runPipeline } from './runner.js';

async function readInstallerVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const raw = await readFile(pkgPath, 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args.unknown.length > 0) {
    process.stderr.write(`unknown argument(s): ${args.unknown.join(', ')}\n`);
    process.stderr.write(HELP_TEXT);
    return 2;
  }

  if (args.skipFlags.has('mcp-only') && args.skipFlags.has('bridge-only')) {
    process.stderr.write('--mcp-only and --bridge-only are mutually exclusive\n');
    return 2;
  }

  const installerVersion = await readInstallerVersion();

  if (args.dryRun) {
    process.stdout.write(
      `create-claude-setup ${installerVersion} — dry-run plan\n` +
        `(no side effects, no state file written)\n\n`,
    );
    const state = newState(installerVersion);
    state.config.skipFlags = [...args.skipFlags];
    const result = await runPipeline(STEPS, state, {
      dryRun: true,
      force: args.force,
      resume: false,
      yes: args.yes,
      skipFlags: args.skipFlags,
    });
    return result.ok ? 0 : 1;
  }

  let state = await loadState();
  if (state && !args.resume) {
    process.stderr.write(
      `existing setup-state.json found at ~/.claude/setup-state.json\n` +
        `pass --resume to continue, or remove the file to start over.\n`,
    );
    return 2;
  }
  if (!state) {
    state = newState(installerVersion);
    state.config.skipFlags = [...args.skipFlags];
    await saveState(state);
  }

  const result = await runPipeline(STEPS, state, {
    dryRun: false,
    force: args.force,
    resume: args.resume,
    yes: args.yes,
    skipFlags: args.skipFlags,
  });

  if (!result.ok) {
    process.stderr.write(
      `\ninstall halted at step "${result.failedAt}". Re-run with --resume to retry.\n`,
    );
    return 1;
  }

  process.stdout.write('\ndone.\n');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
