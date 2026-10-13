import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ARO_DOCS, lookupDocs } from '../src/docs';
import { mcpRouter } from '../src/mcp';

function app() {
  const a = express();
  a.use('/api/aro-planner/mcp', mcpRouter({}));
  return a;
}

/** MCP speaks JSON-RPC over POST; these are the real envelopes a client sends. */
const rpc = (method: string, params: unknown = {}, id = 1) => ({
  jsonrpc: '2.0' as const,
  id,
  method,
  params,
});

const MCP_ACCEPT = 'application/json, text/event-stream';

describe('MCP endpoint', () => {
  it('lists the planner tools', async () => {
    const res = await request(app())
      .post('/api/aro-planner/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }));
    expect(res.status).toBe(200);
    expect(res.text).toContain('aro-planner');
  });

  it('rejects GET with 405 rather than a 404 that looks like a missing route', async () => {
    const res = await request(app()).get('/api/aro-planner/mcp');
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/stateless/i);
  });
});

describe('MCP is not reachable from outside the pod', () => {
  it('refuses a non-loopback caller with 403', async () => {
    const a = express();
    // Simulate arrival through the Route: the TCP peer is not loopback.
    a.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: '10.128.2.17', configurable: true });
      next();
    });
    a.use('/api/aro-planner/mcp', mcpRouter({}));

    const res = await request(a)
      .post('/api/aro-planner/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(rpc('tools/list'));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/in-pod/i);
  });

  it('still allows loopback, which is how the assistant sidecar calls it', async () => {
    const res = await request(app())
      .post('/api/aro-planner/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(rpc('tools/list'));
    expect(res.status).toBe(200);
  });
});

describe('lookupDocs', () => {
  it('finds the supported VM size list', () => {
    const hits = lookupDocs('what vm sizes are supported');
    expect(hits[0]?.topic).toBe('supported-vm-sizes');
    expect(hits[0]?.url).toContain('learn.microsoft.com');
  });

  it('finds pricing', () => {
    expect(lookupDocs('how much does it cost')[0]?.topic).toBe('pricing');
  });

  it('finds the Red Hat network policy page, not just Microsoft ones', () => {
    const hits = lookupDocs('network policy');
    expect(hits.some(h => h.source === 'Red Hat')).toBe(true);
  });

  it('returns nothing for an empty topic rather than everything', () => {
    expect(lookupDocs('')).toEqual([]);
    expect(lookupDocs('   ')).toEqual([]);
  });

  it('caps results so the model is not handed a wall of near-duplicates', () => {
    expect(lookupDocs('cluster', 3).length).toBeLessThanOrEqual(3);
  });

  it('every curated URL is https and non-empty', () => {
    for (const d of ARO_DOCS) {
      expect(d.url).toMatch(/^https:\/\//);
      expect(d.summary.length).toBeGreaterThan(20);
      expect(d.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('a proxy in front of Backstage must not defeat the loopback check', () => {
  // The oauth-proxy sidecar upstreams over localhost, so every external request
  // arrives with a loopback peer address. Without this, adding the proxy would
  // silently open the endpoint to anyone who could log into the cluster.
  it.each([
    'x-forwarded-for',
    'x-forwarded-user',
    'x-forwarded-email',
    'x-forwarded-host',
    'x-forwarded-proto',
    'forwarded',
  ])('rejects a loopback request carrying %s', async header => {
    const res = await request(app()).post('/api/aro-planner/mcp').set(header, 'anything').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/did not originate inside the pod/);
  });

  it('still accepts a direct in-pod call with no proxy headers', async () => {
    // supertest connects over loopback with no forwarded headers, which is
    // exactly the assistant sidecar's shape.
    const res = await request(app()).post('/api/aro-planner/mcp').send({});
    expect(res.status).not.toBe(403);
  });
});
