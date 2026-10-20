import {
  createComponentExtension,
  createPlugin,
  createRoutableExtension,
} from '@backstage/core-plugin-api';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';

import { AroClusterPlannerField } from './fields/AroClusterPlannerField';
import { rootRouteRef } from './routes';

export const aroPlannerPlugin = createPlugin({
  id: 'aro-planner',
  routes: {
    root: rootRouteRef,
  },
});

/** Standalone page, for pricing a cluster without starting a request. */
export const AroPlannerPage = aroPlannerPlugin.provide(
  createRoutableExtension({
    name: 'AroPlannerPage',
    component: () => import('./components/PlannerPage').then(m => m.PlannerPage),
    mountPoint: rootRouteRef,
  }),
);

/**
 * The whole wizard as a single Scaffolder field.
 *
 * Bound to one object-typed parameter rather than several fields: all state stays
 * inside this component, so there are no cross-field dependencies for
 * react-jsonschema-form to mishandle. Reading sibling fields through
 * `formContext.formData` is discouraged upstream and misbehaves in
 * `scaffolder/next`, which is what RHDH ships.
 */
export const AroClusterPlannerFieldExtension = aroPlannerPlugin.provide(
  createScaffolderFieldExtension({
    name: 'AroClusterPlanner',
    component: AroClusterPlannerField,
  }),
);

/** Exposed for embedding the wizard in a card elsewhere in the portal. */
export const AroPlannerWizard = aroPlannerPlugin.provide(
  createComponentExtension({
    name: 'AroPlannerWizard',
    component: { lazy: () => import('./components/Wizard').then(m => m.Wizard) },
  }),
);
