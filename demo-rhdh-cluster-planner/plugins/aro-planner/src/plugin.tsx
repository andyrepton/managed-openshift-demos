import React from 'react';

import CategoryIcon from '@mui/icons-material/Category';
import { createFrontendPlugin, PageBlueprint } from '@backstage/frontend-plugin-api';
import { FormFieldBlueprint } from '@backstage/plugin-scaffolder-react/alpha';

import { rootRouteRef } from './routes';

/**
 * Standalone page, for pricing a cluster without starting a request.
 *
 * RHDH 2.1 runs the Backstage New Frontend System only. A page extension
 * replaces the old `dynamicRoutes` YAML wiring, and the sidebar entry is
 * derived from it (title and icon), so there is no `menuItem` to configure.
 * The loader uses `import()` so the wizard stays out of the plugin's startup
 * chunk.
 */
const plannerPage = PageBlueprint.make({
  params: {
    path: '/deployment-planner',
    routeRef: rootRouteRef,
    title: 'Deployment Planner',
    icon: <CategoryIcon />,
    loader: () => import('./components/PlannerPage').then(m => <m.PlannerPage />),
  },
});

/**
 * The whole wizard as a single Scaffolder field.
 *
 * Bound to one object-typed parameter rather than several fields: all state stays
 * inside this component, so there are no cross-field dependencies for
 * react-jsonschema-form to mishandle. Reading sibling fields through
 * `formContext.formData` is discouraged upstream and misbehaves in
 * `scaffolder/next`, which is what RHDH ships.
 *
 * Discovered by the Scaffolder through `formFieldsApiRef`, so it needs no
 * `scaffolderFieldExtensions` YAML. Templates use `ui:field: AroClusterPlanner`.
 */
const plannerField = FormFieldBlueprint.make({
  name: 'aro-cluster-planner',
  params: {
    field: () => import('./fields/formField').then(m => m.aroClusterPlannerFormField),
  },
});

/** Must be the default export: the New Frontend System discovers plugins by it. */
export default createFrontendPlugin({
  pluginId: 'aro-planner',
  extensions: [plannerPage, plannerField],
  routes: {
    root: rootRouteRef,
  },
});
