import { promises as fs } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import type { Step } from './types.js';

const HEALTH_URL = 'https://localhost:3456/api/health';
const TIMEOUT_MS = 5000;
const CERT_REL_PATH = ['certs', 'cert.pem'];

interface ProbeResult {
  status: number;
  body: string;
}

function probeHealth(ca: Buffer): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      HEALTH_URL,
      { method: 'GET', timeout: TIMEOUT_MS, ca },
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
      req.destroy(new Error(`bridge health probe timed out after ${TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

export const verifyBridgeReachable: Step = {
  name: 'verify-bridge-reachable',
  phase: 'verify',
  description: `HTTPS GET ${HEALTH_URL} with installed cert`,
  preconditions: ['generate-launchd-plist'],
  shouldSkip: (ctx) =>
    ctx.skipFlags.has('mcp-only') ? '--mcp-only' : false,
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

    let result: ProbeResult;
    try {
      result = await probeHealth(ca);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${HEALTH_URL}: probe failed (${msg})`);
    }

    if (result.status !== 200) {
      throw new Error(
        `${HEALTH_URL}: returned status ${result.status} (expected 200) — bridge may not be running`,
      );
    }

    ctx.log(`${HEALTH_URL}: 200 OK`);
  },
};
