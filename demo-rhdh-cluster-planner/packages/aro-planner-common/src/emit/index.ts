import { renderManifests } from './manifests.js';
import { renderPlanMarkdown } from './plan.js';
import { renderTfvars } from './tfvars.js';
import type { EmitBundle, EmitInput } from './types.js';

export * from './types.js';
export { toYaml, toYamlDocuments } from './yaml.js';
export { renderPlanMarkdown } from './plan.js';
export { renderTfvars } from './tfvars.js';
export { renderManifests } from './manifests.js';

const RFC1123 = /[^a-z0-9-]/g;

/**
 * The namespace name, and the name every artifact is keyed by.
 *
 * Shares the trailing-hyphen trim with the NetworkPolicy slug for the same reason:
 * `payments-api-` is a valid-looking string that the API server rejects outright.
 */
export function bundleName(applicationName: string | undefined): string {
  return (
    (applicationName ?? '')
      .toLowerCase()
      .replace(RFC1123, '-')
      .replace(/-+/g, '-')
      .slice(0, 50)
      .replace(/^-+|-+$/g, '') || 'my-application'
  );
}

/**
 * Everything a request produces, as files.
 *
 * Pure: same input, same bytes out. That is what lets the wizard preview the exact
 * artifacts the Scaffolder will publish, rather than an approximation of them.
 *
 * What is emitted depends on the deployment model, and the absences are
 * deliberate - a shared namespace gets no tfvars because it creates no
 * infrastructure, and an on-premises request gets none because Terraform has
 * nothing to do with it.
 */
export function emitBundle(input: EmitInput): EmitBundle {
  const name = bundleName(input.request.applicationName);
  const files = [
    { path: 'plan.md', contents: renderPlanMarkdown(name, input) },
    ...renderManifests(name, input),
  ];

  const tfvars = renderTfvars(name, input);
  if (tfvars) files.push(tfvars);

  // Stable order, so a regenerated bundle produces a readable diff rather than a
  // reshuffle.
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name, files };
}
