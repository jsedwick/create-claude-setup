import { promises as fs } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import type { Step } from './types.js';

const HEALTH_URL = 'https://localhost:3456/api/health';
const PROBE_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];
const CERT_REL_PATH = ['certs', 'cert.pem'];

interface ProbeResult {
  status: number;
  body: string;
}

function probeHealth(ca: Buffer): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      HEALTH_URL,
      { method: 'GET', timeout: PROBE_TIMEOUT_MS, ca },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`bridge health probe timed out after ${PROBE_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Node 20+ wraps connect() failures in an AggregateError with an empty
// `.message`; lift the underlying `.code` (e.g. ECONNREFUSED) so the log
// stays informative.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code) return err.message ? `${code}: ${err.message}` : code;
    return err.message || err.name || 'unknown error';
  }
  return String(err);
}

async function probeWithRetries(
  ca: Buffer,
  log: (msg: string) => void,
): Promise<ProbeResult> {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await probeHealth(ca);
      if (result.status === 200) return result;
      lastError = `status ${result.status} (expected 200)`;
    } catch (err: unknown) {
      lastError = describeError(err);
    }
    if (attempt < maxAttempts) {
      const wait = RETRY_DELAYS_MS[attempt - 1]!;
      log(
        `${HEALTH_URL}: attempt ${attempt}/${maxAttempts} failed (${lastError}); retrying in ${wait}ms`,
      );
      await delay(wait);
    }
  }
  throw new Error(
    `${HEALTH_URL}: probe failed after ${maxAttempts} attempts (${lastError}) — bridge may not be running`,
  );
}

export const verifyBridgeReachable: Step = {
  name: 'verify-bridge-reachable',
  phase: 'verify',
  description: `HTTPS GET ${HEALTH_URL} with installed cert`,
  preconditions: ['generate-launchd-plist'],
  shouldSkip: (ctx) => {
    if (ctx.skipFlags.has('mcp-only')) return '--mcp-only';
    if (ctx.skipFlags.has('no-launchd')) return '--no-launchd';
    return false;
  },
  async run(ctx) {
    const bridgePath = ctx.state.components.bridge?.path;
    if (!bridgePath) {
      throw new Error(
        'state.components.bridge.path is missing — fetch-bridge did not populate state',
      );
    }
    // Node's TLS does not read the macOS Keychain; pass the installer-generated
    // self-signed cert explicitly so the probe trusts it without disabling verification.
    const certPath = join(bridgePath, ...CERT_REL_PATH);
    const ca = await fs.readFile(certPath);

    const result = await probeWithRetries(ca, ctx.log);
    ctx.log(`${HEALTH_URL}: ${result.status} OK`);
  },
};
