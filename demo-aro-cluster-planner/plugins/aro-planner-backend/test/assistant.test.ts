import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { readAssistantConfig, type ConfigReader } from '../src/assistant/config';
import { runChatTurn, type AssistantConfig } from '../src/assistant/client';
import { TOOLS_BY_NAME } from '../src/assistant/tools';
import type { PlannerState } from '../src/assistant/state';
import { assistantRouter } from '../src/assistant/router';
import { WESTEUROPE_PRICES } from './fixtures';

const loadPrices = async () => WESTEUROPE_PRICES;

const state: PlannerState = {
  applicationName: 'payments-api',
  vcpu: 40,
  ramGiB: 160,
  region: 'westeurope',
  flavour: 'hcp',
  highAvailability: true,
  dayTwo: false,
  deploymentModel: 'dedicated-cluster',
  endpoints: [],
};

const cfg: AssistantConfig = {
  enabled: true,
  baseUrl: 'https://model.example/v1',
  apiKey: 'test-key',
  model: 'qwen3',
  timeoutMs: 5000,
  maxRounds: 5,
};

function reader(values: Record<string, string | number>): ConfigReader {
  return {
    getOptionalString: k => (typeof values[k] === 'string' ? (values[k] as string) : undefined),
    getOptionalNumber: k => (typeof values[k] === 'number' ? (values[k] as number) : undefined),
  };
}

const FULL = {
  'aroPlanner.assistant.baseUrl': 'https://model.example/v1',
  'aroPlanner.assistant.apiKey': 'k',
  'aroPlanner.assistant.model': 'qwen3',
};

describe('readAssistantConfig', () => {
  it('is enabled only when all three settings are present', () => {
    expect(readAssistantConfig(reader(FULL)).enabled).toBe(true);
  });

  it.each(Object.keys(FULL))('is disabled, and says so, when %s is missing', missing => {
    const partial = { ...FULL };
    delete (partial as Record<string, string>)[missing];
    const got = readAssistantConfig(reader(partial));
    expect(got.enabled).toBe(false);
    expect(got.disabledReason).toContain(missing);
  });

  it('refuses to send a key over plaintext http', () => {
    const got = readAssistantConfig(
      reader({ ...FULL, 'aroPlanner.assistant.baseUrl': 'http://model.example/v1' }),
    );
    expect(got.enabled).toBe(false);
    expect(got.disabledReason).toMatch(/plaintext http/);
  });

  it('allows http on loopback, for running the backend locally', () => {
    expect(
      readAssistantConfig(
        reader({ ...FULL, 'aroPlanner.assistant.baseUrl': 'http://localhost:8000/v1' }),
      ).enabled,
    ).toBe(true);
  });

  it('never carries a credential when disabled', () => {
    const got = readAssistantConfig(reader({ 'aroPlanner.assistant.apiKey': 'secret' }));
    expect(got.apiKey).toBe('');
  });
});

describe('action tools', () => {
  const ctx = () => ({ state: { ...state, endpoints: [] }, overrides: {}, loadPrices });

  it('set_capacity patches the form and updates the working state', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('set_capacity')!.run({ vcpu: 64, ramGiB: 256 }, c);
    expect(out.action?.patch).toEqual({ vcpu: 64, ramGiB: 256 });
    // The working copy must move too, so a follow-up estimate_cost in the same
    // turn prices what was just set rather than what the user last typed.
    expect(c.state.vcpu).toBe(64);
  });

  it('rejects a capacity outside the allowed range without changing anything', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('set_capacity')!.run({ vcpu: 999999, ramGiB: 1 }, c);
    expect(out.action).toBeUndefined();
    expect(c.state.vcpu).toBe(40);
  });

  it('rejects an application name that is not a valid namespace', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('set_application_name')!.run({ name: 'Payments API' }, c);
    expect(out.action).toBeUndefined();
    expect((out.result as { error: string }).error).toMatch(/not a valid namespace name/);
  });

  it('rejects an invalid region rather than passing it to Azure', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('set_cluster_options')!.run({ region: '../etc' }, c);
    expect(out.action).toBeUndefined();
    expect(c.state.region).toBe('westeurope');
  });

  it('requires a CIDR for an on-premises connection', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('add_network_connection')!.run(
      { name: 'Oracle', direction: 'egress', kind: 'on-premises' },
      c,
    );
    expect(out.action).toBeUndefined();
    expect(c.state.endpoints).toHaveLength(0);
  });

  it('adds a well-formed on-premises connection', async () => {
    const c = ctx();
    const out = await TOOLS_BY_NAME.get('add_network_connection')!.run(
      { name: 'Oracle', direction: 'egress', kind: 'on-premises', cidrs: ['10.0.0.0/8'], port: 1521 },
      c,
    );
    expect(c.state.endpoints).toHaveLength(1);
    expect(out.action?.describe).toBe('Added egress connection "Oracle"');
  });
});

describe('runChatTurn', () => {
  const calls: unknown[] = [];

  function mockModel(...replies: unknown[]) {
    let i = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        calls.push(JSON.parse(init.body));
        const message = replies[Math.min(i++, replies.length - 1)];
        return {
          ok: true,
          json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }),
        } as unknown as Response;
      }),
    );
  }

  const say = (content: string) => ({ role: 'assistant', content });
  const call = (name: string, args: unknown) => ({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });

  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const turn = (msg = 'hello') =>
    runChatTurn(cfg, { messages: [{ role: 'user', content: msg }], state }, {}, loadPrices);

  it('returns a plain answer with no actions', async () => {
    mockModel(say('A namespace is probably enough.'));
    const out = await turn();
    expect(out.reply).toBe('A namespace is probably enough.');
    expect(out.actions).toEqual([]);
  });

  it('sends the current form state to the model', async () => {
    mockModel(say('ok'));
    await turn();
    const sent = (calls[0] as { messages: { content: string }[] }).messages;
    expect(sent.some(m => m.content?.includes('40 vCPU / 160 GiB allocatable'))).toBe(true);
    expect(sent.some(m => m.content?.includes('deployment model: dedicated-cluster'))).toBe(true);
  });

  it('executes an action tool and returns the patch for the browser to apply', async () => {
    mockModel(call('set_capacity', { vcpu: 64, ramGiB: 256 }), say('Done.'));
    const out = await turn();
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]!.patch).toEqual({ vcpu: 64, ramGiB: 256 });
    expect(out.toolsUsed).toEqual(['set_capacity']);
    expect(out.reply).toBe('Done.');
  });

  it('prices what the assistant just set, not what the user last typed', async () => {
    mockModel(
      call('set_capacity', { vcpu: 80, ramGiB: 320 }),
      call('estimate_cost', {}),
      say('That comes to more.'),
    );
    const out = await turn();
    // Third request carries the estimate_cost tool result; it must reflect 80 vCPU.
    const third = calls[2] as { messages: { role: string; content: string }[] };
    const toolResult = third.messages.filter(m => m.role === 'tool').pop()!;
    expect(toolResult.content).toContain('"nodePool"');
    expect(out.actions[0]!.patch).toEqual({ vcpu: 80, ramGiB: 320 });
  });

  it('hands a tool failure back to the model instead of aborting the turn', async () => {
    mockModel(call('set_capacity', { vcpu: -5, ramGiB: 10 }), say('Let me try again.'));
    const out = await turn();
    expect(out.actions).toEqual([]);
    expect(out.reply).toBe('Let me try again.');
  });

  it('ignores a tool the model invents', async () => {
    mockModel(call('delete_cluster', {}), say('I cannot do that.'));
    const out = await turn();
    expect(out.actions).toEqual([]);
    const second = calls[1] as { messages: { role: string; content: string }[] };
    expect(second.messages.pop()!.content).toContain('no such tool');
  });

  it('stops after maxRounds and keeps the actions already taken', async () => {
    mockModel(call('set_capacity', { vcpu: 64, ramGiB: 256 }));
    const out = await runChatTurn(
      { ...cfg, maxRounds: 2 },
      { messages: [{ role: 'user', content: 'go' }], state },
      {},
      loadPrices,
    );
    expect(out.reply).toMatch(/ran out of steps/);
    expect(out.actions.length).toBeGreaterThan(0);
  });
});

describe('the assistant endpoint', () => {
  const app = (c: AssistantConfig) => {
    const a = express();
    a.use('/assistant', assistantRouter(c, {}, loadPrices));
    return a;
  };
  const off: AssistantConfig = { ...cfg, enabled: false, disabledReason: 'Not configured here.' };

  it('reports why it is disabled, without naming a credential', async () => {
    const res = await request(app(off)).get('/assistant/status').expect(200);
    expect(res.body).toEqual({ enabled: false, reason: 'Not configured here.' });
  });

  it('refuses to chat when disabled', async () => {
    await request(app(off))
      .post('/assistant/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }], state })
      .expect(503);
  });

  it('rejects a malformed request with 400, not a hang', async () => {
    const res = await request(app(cfg))
      .post('/assistant/chat')
      .send({ messages: [], state })
      .expect(400);
    expect(res.body.error).toBe('Invalid chat request');
  });

  it('rejects a state the engine could not act on', async () => {
    await request(app(cfg))
      .post('/assistant/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }], state: { ...state, region: '../x' } })
      .expect(400);
  });

  it('never exposes the model endpoint or key in the status', async () => {
    const res = await request(app(cfg)).get('/assistant/status').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('test-key');
    expect(JSON.stringify(res.body)).not.toContain('model.example');
  });

  it('caps how many turns one caller can spend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      }) as unknown as Response),
    );
    const a = app(cfg);
    const body = { messages: [{ role: 'user', content: 'hi' }], state };
    for (let i = 0; i < 10; i++) await request(a).post('/assistant/chat').send(body).expect(200);
    await request(a).post('/assistant/chat').send(body).expect(429);
    vi.unstubAllGlobals();
  });
});
