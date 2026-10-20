import type { PlanInput } from './client';

/**
 * Client for the backend's in-page assistant.
 *
 * The assistant lives in the plugin rather than using RHDH's global Lightspeed
 * drawer because that one is mounted in a separate React tree: it can advise, but
 * it cannot reach this form's state, so it could say "use 64 vCPU" and never set
 * the field. These actions are patches the browser applies.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FormAction {
  tool: string;
  patch: Partial<PlanInput>;
  describe: string;
}

export interface ChatResponse {
  reply: string;
  actions: FormAction[];
  toolsUsed: string[];
}

export interface AssistantStatus {
  enabled: boolean;
  model?: string;
  reason?: string;
}

export async function fetchAssistantStatus(
  baseUrl: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<AssistantStatus> {
  const res = await fetchFn(`${baseUrl}/assistant/status`, { ...(signal ? { signal } : {}) });
  if (!res.ok) {
    return { enabled: false, reason: `The planner backend returned ${res.status}.` };
  }
  return (await res.json()) as AssistantStatus;
}

export async function sendChat(
  baseUrl: string,
  fetchFn: typeof fetch,
  messages: ChatMessage[],
  state: PlanInput,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetchFn(`${baseUrl}/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The backend validates this with the same schema the planner uses, so an
    // incomplete form is rejected with a 400 rather than throwing server-side.
    body: JSON.stringify({ messages, state }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The assistant returned ${res.status}.`);
  }
  return (await res.json()) as ChatResponse;
}
