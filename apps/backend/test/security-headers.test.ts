import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The production headers are the ones that broke the wall display: helmet's
 * default `upgrade-insecure-requests` made the kiosk browser fetch the bundle
 * over https from a plain-HTTP server, so the page rendered blank.
 *
 * The config singleton reads the environment once at import time, so each case
 * resets the module registry and re-imports with the environment it wants.
 */
async function headersFor(env: Record<string, string>): Promise<Headers> {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  vi.resetModules();
  try {
    const { createServer } = await import('../src/server.js');
    const server: Server = createServer().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      return response.headers;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    process.env = previous;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('production security headers', () => {
  it('does not upgrade requests or pin HSTS on a plain-HTTP install', async () => {
    const headers = await headersFor({ NODE_ENV: 'production' });

    const csp = headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(headers.get('strict-transport-security')).toBeNull();
  });

  it('restores both once the app is served over TLS', async () => {
    const headers = await headersFor({ NODE_ENV: 'production', HTTPS_ENABLED: 'true' });

    expect(headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(headers.get('strict-transport-security')).toContain('max-age=');
  });
});
