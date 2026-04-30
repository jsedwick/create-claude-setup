import { request } from 'node:https';
import type { Step } from './types.js';

const HEALTH_URL = 'https://localhost:3456/api/health';
const TIMEOUT_MS = 5000;

interface ProbeResult {
  status: number;
  body: string;
}

function probeHealth(): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const req = request(HEALTH_URL, { method: 'GET', timeout: TIMEOUT_MS }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
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
    let result: ProbeResult;
    try {
      result = await probeHealth();
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
