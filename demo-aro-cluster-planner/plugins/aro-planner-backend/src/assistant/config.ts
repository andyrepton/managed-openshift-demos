import type { AssistantConfig } from './client';

/** Minimal view of Backstage's config service, so this is testable as a plain function. */
export interface ConfigReader {
  getOptionalString(key: string): string | undefined;
  getOptionalNumber(key: string): number | undefined;
  getOptionalBoolean?(key: string): boolean | undefined;
}

const DEFAULTS = {
  /**
   * Per model request. Generous because reasoning models are slow: Qwen with
   * ten tool schemas routinely takes tens of seconds for one call.
   */
  timeoutMs: 120_000,
  /**
   * Whole turn. Must stay under the Route's own timeout or haproxy cuts the
   * connection first and the browser gets a bare 504 with no explanation -
   * see haproxy.router.openshift.io/timeout in the demo-developer-hub README.
   */
  turnTimeoutMs: 300_000,
  maxRounds: 5,
  /** Reasoning comes out of this. 1024 was not enough for ten tool schemas. */
  maxTokens: 4096,
  /** Only used when thinking is enabled. */
  reasoningEffort: 'low' as const,
  /** See AssistantConfig.thinking - off because the gateway cuts at ~60s. */
  thinking: false,
};

/**
 * Read the assistant's model endpoint.
 *
 * Disabled unless a base URL, an API key and a model name are all present. The
 * key must arrive through an environment variable - `${ARO_PLANNER_AI_API_KEY}`
 * in app-config, backed by a Secret - and never as a literal, so there is nothing
 * to leak if app-config ends up in git.
 *
 * Disabled is the shipped state on purpose. This instance allows guest sign-in,
 * and a configured key on a public Route is a credential anyone can spend. The
 * UI says "not connected" rather than offering an input that quietly fails, and
 * `reason` is what it shows.
 */
export function readAssistantConfig(config: ConfigReader): AssistantConfig {
  const baseUrl = config.getOptionalString('aroPlanner.assistant.baseUrl')?.trim();
  const apiKey = config.getOptionalString('aroPlanner.assistant.apiKey')?.trim();
  const model = config.getOptionalString('aroPlanner.assistant.model')?.trim();

  const missing = [
    !baseUrl && 'aroPlanner.assistant.baseUrl',
    !apiKey && 'aroPlanner.assistant.apiKey',
    !model && 'aroPlanner.assistant.model',
  ].filter(Boolean) as string[];

  const effort = config.getOptionalString('aroPlanner.assistant.reasoningEffort');
  const base: Pick<
    AssistantConfig,
    'timeoutMs' | 'turnTimeoutMs' | 'maxRounds' | 'maxTokens' | 'reasoningEffort' | 'thinking'
  > = {
    thinking: config.getOptionalBoolean?.('aroPlanner.assistant.thinking') ?? DEFAULTS.thinking,
    maxTokens: config.getOptionalNumber('aroPlanner.assistant.maxTokens') ?? DEFAULTS.maxTokens,
    reasoningEffort:
      effort === 'low' || effort === 'medium' || effort === 'xhigh'
        ? effort
        : DEFAULTS.reasoningEffort,
    timeoutMs: config.getOptionalNumber('aroPlanner.assistant.timeoutMs') ?? DEFAULTS.timeoutMs,
    turnTimeoutMs:
      config.getOptionalNumber('aroPlanner.assistant.turnTimeoutMs') ?? DEFAULTS.turnTimeoutMs,
    maxRounds: config.getOptionalNumber('aroPlanner.assistant.maxRounds') ?? DEFAULTS.maxRounds,
  };

  if (missing.length > 0) {
    return {
      ...base,
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      disabledReason: `No model endpoint configured (missing ${missing.join(', ')}).`,
    };
  }

  // A plaintext http endpoint would put the key and the conversation on the wire
  // in the clear. Loopback is the exception, for running the backend locally.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl!);
  if (!baseUrl!.startsWith('https://') && !isLocal) {
    return {
      ...base,
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      disabledReason:
        'The model endpoint must be https. Refusing to send an API key over plaintext http.',
    };
  }

  return { ...base, enabled: true, baseUrl: baseUrl!, apiKey: apiKey!, model: model! };
}
