import React from 'react';

import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';

/**
 * Sidebar icon for the plugin.
 *
 * RHDH's `menuItem.icon` takes a name from its internal icon catalog, not an
 * arbitrary string: Backstage's system icons plus anything a plugin registers
 * through `appIcons`. Naming an icon that is not in the catalog - `code`, for
 * instance - renders a broken one. So this is exported and registered by name.
 *
 * It must be an icon component. Pointing `appIcons.importName` at a page
 * component instead makes RHDH render the whole page inside the sidebar.
 */
export function DevSpacesIcon(props: React.ComponentProps<typeof DeveloperModeIcon>) {
  return <DeveloperModeIcon {...props} />;
}
