import React from 'react';

import { createFrontendPlugin, PageBlueprint } from '@backstage/frontend-plugin-api';

import { DevSpacesIcon } from './components/DevSpacesIcon';
import { rootRouteRef } from './routes';

/**
 * The request page. One route; there is no Scaffolder field here.
 *
 * RHDH 2.1 runs the Backstage New Frontend System only. This page extension
 * replaces the old `dynamicRoutes` and `appIcons` YAML wiring: the sidebar
 * entry is derived from its title and icon. The loader uses `import()` so the
 * form stays out of the plugin's startup chunk.
 */
const requestPage = PageBlueprint.make({
  params: {
    path: '/devspaces-self-service',
    routeRef: rootRouteRef,
    title: 'Request a Dev Space',
    icon: <DevSpacesIcon />,
    loader: () => import('./components/RequestPage').then(m => <m.RequestPage />),
  },
});

/** Must be the default export: the New Frontend System discovers plugins by it. */
export default createFrontendPlugin({
  pluginId: 'devspaces-self-service',
  extensions: [requestPage],
  routes: {
    root: rootRouteRef,
  },
});
