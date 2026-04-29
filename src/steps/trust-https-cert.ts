import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Step } from './types.js';

const CERTS_SUBDIR = 'certs';
const CERT_FILENAME = 'cert.pem';
const LOGIN_KEYCHAIN = join(
  homedir(),
  'Library',
  'Keychains',
  'login.keychain-db',
);

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function certFingerprintSha1(certPath: string): Promise<string> {
  const result = await runCommand('openssl', [
    'x509',
    '-in',
    certPath,
    '-noout',
    '-fingerprint',
    '-sha1',
  ]);
  if (result.code !== 0) {
    throw new Error(
      `openssl failed to compute cert fingerprint (exit ${result.code}): ${result.stderr.trim() || '(no stderr)'}`,
    );
  }
  const match = result.stdout.match(/Fingerprint=([0-9A-Fa-f:]+)/);
  if (!match) {
    throw new Error(
      `Could not parse openssl SHA-1 fingerprint output: ${result.stdout.trim()}`,
    );
  }
  return match[1]!.replace(/:/g, '').toUpperCase();
}

async function isCertInKeychain(
  sha1: string,
  keychain: string,
): Promise<boolean> {
  const result = await runCommand('security', [
    'find-certificate',
    '-Z',
    '-a',
    keychain,
  ]);
  if (result.code !== 0) return false;
  return result.stdout.toUpperCase().includes(`SHA-1 HASH: ${sha1}`);
}

export const trustHttpsCert: Step = {
  name: 'trust-https-cert',
  phase: 'install',
  description:
    'Trust self-signed bridge cert in the user login keychain (SSL policy, root)',
  preconditions: ['generate-https-cert'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('mcp-only') ? '--mcp-only' : false,
  async run(ctx) {
    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) {
      throw new Error(
        'state.components.bridge.path is missing — fetch-bridge did not populate state',
      );
    }

    const certPath = join(bridgePath, CERTS_SUBDIR, CERT_FILENAME);
    try {
      await fs.access(certPath);
    } catch {
      throw new Error(
        `cert file not found at ${certPath} — generate-https-cert did not produce expected output`,
      );
    }

    const sha1 = await certFingerprintSha1(certPath);

    if (await isCertInKeychain(sha1, LOGIN_KEYCHAIN)) {
      ctx.log(
        `${certPath}: already in login keychain (SHA-1 ${sha1}) — assuming trusted`,
      );
      return;
    }

    const result = await runCommand('security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-p',
      'ssl',
      '-k',
      LOGIN_KEYCHAIN,
      certPath,
    ]);
    if (result.code !== 0) {
      throw new Error(
        `security add-trusted-cert failed (exit ${result.code}): ${result.stderr.trim() || '(no stderr)'}. ` +
          'You may need to confirm the keychain access prompt or unlock your login keychain.',
      );
    }

    ctx.log(
      `${certPath}: trusted in login keychain (SSL policy, root, SHA-1 ${sha1})`,
    );
  },
};
