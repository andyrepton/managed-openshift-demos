import type { PricingOverrides } from '@aro-planner/common';

import { TOOLS, TOOLS_BY_NAME, type PriceLoader, type ToolContext } from './tools';
import type { ChatRequest, ChatResponse, FormAction, PlannerState } from './state';

/**
 * An OpenAI-compatible chat client with tool calling.
 *
 * OpenAI-compatible rather than Anthropic-native because that is what the MaaS
 * gateway and vLLM both speak directly - see demo-claude-via-open-source-models,
 * where LiteLLM exists purely to translate the other way. Talking the native
 * dialect of the endpoint removes a hop and a component.
 */

/**
 * The endpoint answered, but with an error status.
 *
 * Distinguished from a network failure because the two need different fixes and
 * reporting both as "could not reach the model endpoint" sends you looking at
 * firewalls when the real answer is in the response body.
 */
export class ModelHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Model endpoint returned ${status}`);
    this.name = 'ModelHttpError';
  }
}

export interface AssistantConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Why it is off, shown in the UI instead of a dead input box. */
  disabledReason?: string;
  /** Per model request, NOT per turn. A turn makes up to maxRounds of them. */
  timeoutMs: number;
  /** Whole-turn budget, so a turn cannot run for maxRounds x timeoutMs. */
  turnTimeoutMs: number;
  /** Tool calls cost a round trip each; this bounds a turn. */
  maxRounds: number;
  /**
   * Completion budget per request. Reasoning tokens come out of this, and with
   * ten tool schemas Qwen spends ~1100 of them before answering - at the old
   * 1024 every turn ended `finish_reason: "length"` with no content and no tool
   * calls, which reached the browser as a successful but completely empty reply.
   */
  maxTokens: number;
  /**
   * Qwen's reasoning budget, used only when `thinking` is on. Only `low`,
   * `medium` and `xhigh` are accepted - `high` is rejected outright, and
   * `xhigh` returns an empty response a fair fraction of the time.
   */
  reasoningEffort?: 'low' | 'medium' | 'xhigh';
  /**
   * Let the model think before answering. OFF by default, and the difference is
   * not subtle: on this workload Qwen spends ~1100 tokens and 50-60s reasoning,
   * against 2-3s with it off. The MaaS gateway cuts any request at about 60
   * seconds - streaming does not help, nothing is sent before the cut - so
   * thinking turns a working assistant into one that fails on anything
   * non-trivial.
   *
   * The quality cost is small here because the tools do the actual reasoning:
   * every number comes from the planner engine, and the loop can take several
   * rounds. Turn it on only against an endpoint without a short request timeout.
   */
  thinking: boolean;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

const SYSTEM_PROMPT = `You help a platform team decide where to run an application, inside a form they are filling in.

You can both ANSWER and ACT. The form is in front of the user; your action tools
change it, and they watch the cost panel move as you do. Prefer acting over
describing: if the user tells you what they need, set it rather than telling them
what to type.

Rules that matter more than being helpful:

- NEVER state a price, instance type or capacity from memory. Call the tools. They
  run the same code as the page, so your numbers and the page's numbers agree.
  Numbers you invent will contradict what the user is looking at.
- Only the dedicated ARO cluster is priced from a real meter (the Azure Retail
  Prices API). The shared-namespace and on-premises figures are INVENTED
  MULTIPLIERS for this demo. When you mention either, say so in the same breath.
  Never let an assumed figure sound like an Azure price.
- Pass on every caveat the tools return, especially the NetworkPolicy ones. If a
  tool says something cannot be expressed as a NetworkPolicy, say that; do not
  offer a rule that looks right instead.
- vCPU and memory on this form are ALLOCATABLE - what pods can request. Per-node
  OpenShift overhead is added on top automatically. Do not pad the numbers
  yourself.
- Cost is not a reason on its own to choose on-premises, because that figure is an
  assumption. Data residency, existing hardware or latency to something on-site
  are reasons.
- If you do not know, say so and offer to look it up with lookup_aro_doc.

Be brief. Two or three sentences plus what you changed. The user can see the form,
so do not read it back to them.`;

/** The form, summarised for the model. Cheaper and clearer than raw JSON. */
function describeState(s: PlannerState): string {
  const lines = [
    `application name: ${s.applicationName || '(not set)'}`,
    `deployment model: ${s.deploymentModel}`,
    `capacity: ${s.vcpu} vCPU / ${s.ramGiB} GiB allocatable (${(s.ramGiB / s.vcpu).toFixed(1)} GiB per vCPU)`,
    `workload profile: ${s.profile || '(inferred from the ratio)'}`,
    s.storageGiB > 0
      ? `persistent storage: ${s.storageGiB} GiB (${s.storageTier})`
      : 'persistent storage: none',
  ];
  if (s.deploymentModel !== 'on-premises') {
    lines.push(
      `architecture: ${s.flavour === 'hcp' ? 'ARO hosted control planes' : 'ARO standard'}`,
      `region: ${s.region}`,
      `availability zones: ${s.highAvailability ? 'three' : 'one'}`,
    );
  }
  lines.push(
    s.endpoints.length === 0
      ? 'connections: none yet'
      : `connections: ${s.endpoints
          .map(e => `${e.name} (${e.direction} -> ${e.target.kind})`)
          .join(', ')}`,
  );
  return `Current form state:\n${lines.map(l => `- ${l}`).join('\n')}`;
}

const toolSchemas = () =>
  TOOLS.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

interface Completion {
  choices: { message: ChatMessage; finish_reason: string }[];
}

/** The model hit its token budget before saying anything usable. */
export class TruncatedError extends Error {
  constructor() {
    super('The model used its whole token budget before answering');
    this.name = 'TruncatedError';
  }
}

async function complete(
  cfg: AssistantConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<ChatMessage> {
  // Reasoning models are slow: a single Qwen call with ten tool schemas takes
  // tens of seconds. The timeout therefore applies to each request, with the
  // turn deadline below bounding the total.
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools: toolSchemas(),
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: cfg.maxTokens,
      ...(cfg.thinking
        ? cfg.reasoningEffort
          ? { reasoning_effort: cfg.reasoningEffort }
          : {}
        : // Qwen's own switch. Not `/no_think` in the prompt, which returns
          // empty responses on Qwen3's hybrid architecture.
          { chat_template_kwargs: { enable_thinking: false } }),
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ModelHttpError(res.status, body.slice(0, 1000));
  }

  const json = (await res.json()) as Completion;
  const choice = json.choices?.[0];
  if (!choice?.message) throw new Error('Model endpoint returned no message');

  // Truncation is reported as a perfectly ordinary 200, so it has to be caught
  // here or it surfaces as silence.
  const { message, finish_reason: finish } = choice;
  if (finish === 'length' && !message.content && !(message.tool_calls ?? []).length) {
    throw new TruncatedError();
  }
  return message;
}

/**
 * Run one turn: call the model, execute whatever it asks for, call it again.
 *
 * Read-only tools are executed here and their results fed back. Action tools are
 * executed against a WORKING COPY of the form state and collected for the browser
 * to apply. Mutating the working copy matters: it means "make it bigger and tell
 * me what that costs" prices the new size, not the old one.
 */
export async function runChatTurn(
  cfg: AssistantConfig,
  req: ChatRequest,
  overrides: Partial<PricingOverrides>,
  loadPrices: PriceLoader,
): Promise<ChatResponse> {
  const deadline = Date.now() + cfg.turnTimeoutMs;

  try {
    const ctx: ToolContext = {
      // Deep enough: endpoints is the only nested field, and tools replace it
      // wholesale rather than mutating it in place.
      state: { ...req.state, endpoints: [...req.state.endpoints] },
      overrides,
      loadPrices,
    };

    // ONE system message, and it must come first.
    //
    // Qwen's chat template rejects a system message that is not at the start -
    // the gateway answers 400 "System message must be at the beginning." Sending
    // the prompt and the form state as two system messages failed every turn.
    // Concatenating them is also just more portable; nothing requires two.
    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${describeState(req.state)}` },
      ...req.messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const actions: FormAction[] = [];
    const toolsUsed: string[] = [];

    for (let round = 0; round < cfg.maxRounds; round++) {
      if (Date.now() >= deadline) {
        return {
          reply:
            'I ran out of time before finishing. Anything already changed above ' +
            'has been applied - ask me to carry on.',
          actions,
          toolsUsed,
        };
      }

      // One controller per request. Previously a single 60s budget covered the
      // whole turn, so a tool-using conversation - which is the normal case -
      // aborted part way through for no visible reason.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      let reply: ChatMessage;
      try {
        reply = await complete(cfg, messages, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      const calls = reply.tool_calls ?? [];

      if (calls.length === 0) {
        const text = (reply.content ?? '').trim();
        // Never hand back an empty bubble. If the model changed the form but
        // said nothing, describe what it did; if it did neither, say so plainly
        // rather than looking like it ignored the question.
        if (text) return { reply: text, actions, toolsUsed };
        return {
          reply:
            actions.length > 0
              ? // Only the first character, so "64 vCPU" does not become "64 vcpu".
                `Done: ${actions
                  .map(a => a.describe.charAt(0).toLowerCase() + a.describe.slice(1))
                  .join('; ')}.`
              : 'I did not get a usable answer from the model. Try rephrasing, ' +
                'or ask for one thing at a time.',
          actions,
          toolsUsed,
        };
      }

      messages.push(reply);

      for (const call of calls) {
        const tool = TOOLS_BY_NAME.get(call.function.name);
        if (!tool) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({ error: `no such tool: ${call.function.name}` }),
          });
          continue;
        }

        let payload: unknown;
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          const out = await tool.run(args as Record<string, unknown>, ctx);
          payload = out.result;
          if (out.action) actions.push(out.action);
          toolsUsed.push(tool.name);
        } catch (err) {
          // Hand the failure back to the model rather than aborting the turn -
          // it can usually correct a bad argument on the next round.
          payload = { error: err instanceof Error ? err.message : String(err) };
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: tool.name,
          content: JSON.stringify(payload).slice(0, 8000),
        });
      }
    }

    // Out of rounds. The actions already taken are still valid and are returned,
    // because discarding them would leave the form half-changed with no record.
    return {
      reply:
        'I made the changes above but ran out of steps before finishing. Ask me to ' +
        'carry on if that is not what you wanted.',
      actions,
      toolsUsed,
    };
  } finally {
    // Nothing to clean up: each request owns and clears its own timer.
  }
}
