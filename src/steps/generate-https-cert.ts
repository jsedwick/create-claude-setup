import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Step } from './types.js';

const CERTS_SUBDIR = 'certs';
const CERT_FILENAME = 'cert.pem';
const KEY_FILENAME = 'key.pem';
const CERT_DAYS = 825;
const CERT_SUBJECT = '/CN=localhost';
const CERT_SAN = 'subjectAltName=DNS:localhost,IP:127.0.0.1';

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function runOpenssl(certOut: string, keyOut: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyOut,
        '-out',
        certOut,
        '-days',
        String(CERT_DAYS),
        '-subj',
        CERT_SUBJECT,
        '-addext',
        CERT_SAN,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(
        new Error(
          `openssl failed to launch: ${err.message}. Ensure OpenSSL is installed and on PATH.`,
        ),
      );
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `openssl exited with code ${code}: ${stderr.trim() || '(no stderr)'}`,
          ),
        );
    });
  });
}

export const generateHttpsCert: Step = {
  name: 'generate-https-cert',
  phase: 'install',
  description:
    'Generate self-signed cert for bridge HTTPS (RSA 2048, 825 days, localhost+127.0.0.1)',
  preconditions: ['write-bridge-config'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('mcp-only') ? '--mcp-only' : false,
  async run(ctx) {
    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) {
      throw new Error(
        'state.components.bridge.path is missing — fetch-bridge did not populate state',
      );
    }

    const certsDir = join(bridgePath, CERTS_SUBDIR);
    const certPath = join(certsDir, CERT_FILENAME);
    const keyPath = join(certsDir, KEY_FILENAME);

    const existingCert = await readIfExists(certPath);
    const existingKey = await readIfExists(keyPath);
    const recordedCertHash = ctx.state.fileManifest[certPath];
    const recordedKeyHash = ctx.state.fileManifest[keyPath];

    if (existingCert !== null && existingKey !== null) {
      const existingCertHash = sha256(existingCert);
      const existingKeyHash = sha256(existingKey);
      const installerOwned =
        recordedCertHash === existingCertHash &&
        recordedKeyHash === existingKeyHash;

      if (installerOwned) {
        ctx.log(`${certPath}: up to date (installer-generated cert+key)`);
        return;
      }

      if (!ctx.force) {
        ctx.log(
          `${certPath}: preserving user-supplied cert+key (use --force to regenerate)`,
        );
        return;
      }
    }

    await fs.mkdir(certsDir, { recursive: true });
    const suffix = `${process.pid}.${randomBytes(4).toString('hex')}`;
    const stagingCert = `${certPath}.${suffix}.tmp`;
    const stagingKey = `${keyPath}.${suffix}.tmp`;

    try {
      await runOpenssl(stagingCert, stagingKey);
      await fs.rename(stagingCert, certPath);
      await fs.rename(stagingKey, keyPath);
    } catch (err) {
      await unlinkIfExists(stagingCert);
      await unlinkIfExists(stagingKey);
      throw err;
    }

    const certBytes = await fs.readFile(certPath);
    const keyBytes = await fs.readFile(keyPath);
    ctx.state.fileManifest[certPath] = sha256(certBytes);
    ctx.state.fileManifest[keyPath] = sha256(keyBytes);

    ctx.log(
      `${certPath}: generated self-signed cert (CN=localhost, ${CERT_DAYS} days)`,
    );
  },
};
