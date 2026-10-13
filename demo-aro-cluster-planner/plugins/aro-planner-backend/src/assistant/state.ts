import { z } from 'zod';

import { endpointSchema } from '../schema';

/**
 * The wizard's form, as the assistant sees it.
 *
 * Mirrors `PlanInput` on the frontend. The assistant is sent the current state
 * with every turn and answers in terms of it, which is the whole difference
 * between this and RHDH's global Lightspeed drawer - that one is mounted in a
 * separate React tree and can neither read this nor write to it.
 */
export const plannerStateSchema = z.object({
  applicationName: z.string().max(100).optional(),
  vcpu: z.number().positive().max(20000),
  ramGiB: z.number().positive().max(200000),
  region: z.string().regex(/^[a-z0-9]{3,40}$/),
  flavour: z.enum(['hcp', 'classic']),
  profile: z.string().optional(),
  highAvailability: z.boolean(),
  dayTwo: z.boolean().default(false),
  deploymentModel: z.enum(['shared-namespace', 'dedicated-cluster', 'on-premises']),
  storageGiB: z.number().min(0).max(32767).default(0),
  storageTier: z.enum(['premium-ssd', 'standard-ssd']).default('premium-ssd'),
  endpoints: z.array(endpointSchema).max(50).default([]),
});

export type PlannerState = z.infer<typeof plannerStateSchema>;

/**
 * A change the assistant wants made to the form.
 *
 * Returned to the browser rather than applied server-side, because the form is
 * client state - there is nothing on the server to mutate. The client applies the
 * patch and the cost panel moves, which is what makes the assistant feel like it
 * is driving the page rather than talking about it.
 */
export interface FormAction {
  /** The tool that produced it, for the audit line in the UI. */
  tool: string;
  /** Shallow merge into the form state. */
  patch: Partial<PlannerState>;
  /** One line, shown to the user: "Set capacity to 64 vCPU / 256 GiB". */
  describe: string;
}

export const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(40),
  state: plannerStateSchema,
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResponse {
  reply: string;
  actions: FormAction[];
  /** Which tools ran, so the UI can show the assistant used the engine. */
  toolsUsed: string[];
}
