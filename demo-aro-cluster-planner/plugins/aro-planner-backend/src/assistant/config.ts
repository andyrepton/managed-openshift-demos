import type { AssistantConfig } from './client';

/** Minimal view of Backstage's config service, so this is testable as a plain function. */
export interface ConfigReader {
  getOptionalString(key: string): string | undefined;
  getOptionalNumber(key: string): number | undefined;
}

const DEFAULTS = {
  timeoutMs: 60_000,
  maxRounds: 5,
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

  const base: Pick<AssistantConfig, 'timeoutMs' | 'maxRounds'> = {
    timeoutMs: config.getOptionalNumber('aroPlanner.assistant.timeoutMs') ?? DEFAULTS.timeoutMs,
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
