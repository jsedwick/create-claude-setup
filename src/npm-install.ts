import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface NpmInstallResult {
  prefix: string;
  packageName: string;
  installedVersion: string;
  packagePath: string;
}

export async function npmInstallToPrefix(opts: {
  prefix: string;
  packageName: string;
  packageSpec: string;
  log: (msg: string) => void;
}): Promise<NpmInstallResult> {
  await mkdir(opts.prefix, { recursive: true });

  const args = [
    'install',
    `--prefix=${opts.prefix}`,
    '--no-fund',
    '--no-audit',
    '--no-progress',
    opts.packageSpec,
  ];

  opts.log(`npm ${args.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else if (signal) reject(new Error(`npm install killed by signal ${signal}`));
      else reject(new Error(`npm install exited with code ${code}`));
    });
  });

  const packagePath = join(opts.prefix, 'node_modules', opts.packageName);
  const pkgJsonPath = join(packagePath, 'package.json');
  let installedVersion: string;
  try {
    const raw = await readFile(pkgJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    if (!parsed.version) {
      throw new Error(`installed package.json has no version field`);
    }
    installedVersion = parsed.version;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `npm install reported success but ${pkgJsonPath} is unreadable: ${msg}`,
    );
  }

  return {
    prefix: opts.prefix,
    packageName: opts.packageName,
    installedVersion,
    packagePath,
  };
}
