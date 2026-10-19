import { createPlugin, createRoutableExtension } from '@backstage/core-plugin-api';

import { rootRouteRef } from './routes';

export const devspacesSelfServicePlugin = createPlugin({
  id: 'devspaces-self-service',
  routes: {
    root: rootRouteRef,
  },
});

/** The request page. One route; there is no Scaffolder field here. */
export const DevSpacesSelfServicePage = devspacesSelfServicePlugin.provide(
  createRoutableExtension({
    name: 'DevSpacesSelfServicePage',
    component: () => import('./components/RequestPage').then(m => m.RequestPage),
    mountPoint: rootRouteRef,
  }),
);
