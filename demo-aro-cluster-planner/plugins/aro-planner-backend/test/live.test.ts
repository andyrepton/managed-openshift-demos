import { describe, expect, it } from 'vitest';

import { runChatTurn, type AssistantConfig } from '../src/assistant/client';
import type { PlannerState } from '../src/assistant/state';
import { buildPriceTable } from '@aro-planner/common';

/**
 * A real turn against a real model endpoint.
 *
 * Skipped unless `LIVE_ASSISTANT=1`, because it needs credentials, costs tokens
 * and takes the better part of a minute. Everything else is unit-tested against
 * a stubbed model; this exists because the failures that actually bit - a
 * rejected second system message, a token budget swallowed by reasoning - are
 * exactly the ones a stub cannot reproduce.
 *
 *   set -a; . ~/.secrets/maas.sh; set +a
 *   LIVE_ASSISTANT=1 \
 *   ASSISTANT_BASE_URL="$MAAS_API_URL" ASSISTANT_API_KEY="$MAAS_API_KEY" \
 *   npx vitest run test/live.test.ts
 */

const live = process.env.LIVE_ASSISTANT === '1';

const cfg: AssistantConfig = {
  enabled: true,
  baseUrl: process.env.ASSISTANT_BASE_URL ?? '',
  apiKey: process.env.ASSISTANT_API_KEY ?? '',
  model: process.env.ASSISTANT_MODEL ?? 'qwen38-27b',
  timeoutMs: 120_000,
  turnTimeoutMs: 300_000,
  maxTokens: 4096,
  reasoningEffort: 'low',
  thinking: false,
  maxRounds: 5,
};

const state: PlannerState = {
  vcpu: 40,
  ramGiB: 160,
  region: 'westeurope',
  flavour: 'hcp',
  highAvailability: true,
  dayTwo: false,
  deploymentModel: 'dedicated-cluster',
  storageGiB: 0,
  storageTier: 'premium-ssd' as const,
  endpoints: [],
};

describe.skipIf(!live)('a real turn against a real model', () => {
  it(
    'answers and changes the form',
    async () => {
      const out = await runChatTurn(
        cfg,
        {
          messages: [
            {
              role: 'user',
              content:
                process.env.LIVE_PROMPT ??
                'Payments team, 50 users, needs our on-prem Oracle',
            },
          ],
          state,
        },
        {},
        (skus, region) => buildPriceTable(skus, region),
      );

      // eslint-disable-next-line no-console
      console.log(
        '\nreply:', JSON.stringify(out.reply),
        '\ntools:', out.toolsUsed,
        '\nactions:', out.actions.map(a => a.describe),
      );

      // The failure this test exists for: a 200 carrying nothing at all.
      expect(out.reply === '' && out.actions.length === 0).toBe(false);
      expect(out.toolsUsed.length).toBeGreaterThan(0);
    },
    300_000,
  );
});
