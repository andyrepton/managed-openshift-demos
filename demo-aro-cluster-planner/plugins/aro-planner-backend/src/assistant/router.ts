import express, { type Request, type Response, type Router } from 'express';

import type { PricingOverrides } from '@aro-planner/common';

import { runChatTurn, type AssistantConfig } from './client';
import { chatRequestSchema } from './state';
import type { PriceLoader } from './tools';

/**
 * The in-page assistant's endpoint.
 *
 * Separate from the MCP router because the two have opposite threat models. MCP
 * is for the in-pod sidecar and is restricted to loopback; this one is called by
 * a browser and must therefore be reachable through the Route. That is exactly
 * why it is off unless a model endpoint is configured: an endpoint that spends
 * tokens, on an instance that allows guest sign-in, is a credential anyone on the
 * internet can draw on.
 */

/**
 * A crude per-caller budget.
 *
 * Not a general rate limiter - it exists so that one person, or one runaway
 * retry loop, cannot empty a token quota before anyone notices. In-memory and
 * per-replica, which is proportionate for a demo; a real deployment would put
 * this at the gateway.
 */
class Budget {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);

    // Bound the map so a stream of distinct callers cannot grow it without limit.
    if (this.hits.size > 1000) {
      for (const [k, v] of this.hits) {
        if (v.every(x => t - x >= this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}

const MAX_TURNS_PER_MINUTE = 10;

export function assistantRouter(
  cfg: AssistantConfig,
  overrides: Partial<PricingOverrides>,
  loadPrices: PriceLoader,
): Router {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  const budget = new Budget(MAX_TURNS_PER_MINUTE, 60_000);

  /**
   * Whether the assistant can be used, and if not, why.
   *
   * The UI calls this on mount so it can render a disabled input with a real
   * reason rather than an input that accepts text and silently discards it.
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      enabled: cfg.enabled,
      ...(cfg.enabled ? { model: cfg.model } : { reason: cfg.disabledReason }),
    });
  });

  router.post('/chat', async (req: Request, res: Response) => {
    if (!cfg.enabled) {
      res.status(503).json({ error: cfg.disabledReason ?? 'The assistant is not configured.' });
      return;
    }

    const key = req.socket.remoteAddress ?? 'unknown';
    if (!budget.take(key)) {
      res.status(429).json({ error: 'Too many requests. Give it a minute.' });
      return;
    }

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid chat request',
        detail: parsed.error.issues
          .map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join('; '),
      });
      return;
    }

    try {
      res.json(await runChatTurn(cfg, parsed.data, overrides, loadPrices));
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      // The upstream message can carry endpoint detail, so it is summarised
      // rather than forwarded. The full error goes to the server log.
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? 'The model took too long to answer.'
          : 'Could not reach the model endpoint.',
      });
    }
  });

  return router;
}
