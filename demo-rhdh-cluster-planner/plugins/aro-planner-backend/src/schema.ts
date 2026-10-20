import { z } from 'zod';

/**
 * Endpoint validation, shared by the HTTP and MCP paths.
 *
 * Previously only MCP validated. The HTTP handler filtered on `name` alone, so a
 * payload missing `target` threw inside an async Express handler - no response,
 * client waits for its timeout. One schema, both callers.
 */
export const endpointSchema = z.object({
  name: z.string().min(1),
  direction: z.enum(['ingress', 'egress']),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('internet') }),
    z.object({ kind: z.literal('namespace'), namespace: z.string().min(1) }),
    z.object({ kind: z.literal('on-premises'), cidrs: z.array(z.string()).default([]) }),
    z.object({ kind: z.literal('azure-service'), service: z.string().min(1) }),
  ]),
  ports: z
    .array(z.object({ protocol: z.enum(['TCP', 'UDP']), port: z.number().int().positive().max(65535) }))
    .optional(),
});

export const endpointsSchema = z.array(endpointSchema).max(50).default([]);
