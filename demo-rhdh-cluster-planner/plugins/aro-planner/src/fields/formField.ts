import { createFormField } from '@backstage/plugin-scaffolder-react/alpha';

import { AroClusterPlannerField } from './AroClusterPlannerField';

/**
 * Kept in its own module so the plugin entry can load it with `import()`: the
 * wizard it renders is the heaviest part of the bundle.
 *
 * `name` is what templates put in `ui:field`, so it must stay `AroClusterPlanner`.
 */
export const aroClusterPlannerFormField = createFormField({
  name: 'AroClusterPlanner',
  component: AroClusterPlannerField,
});
