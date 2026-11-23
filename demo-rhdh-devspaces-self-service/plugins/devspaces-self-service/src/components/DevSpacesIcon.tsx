import React from 'react';

import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';

/**
 * Sidebar icon for the plugin, passed to the page extension's `icon` param.
 *
 * Kept as its own small module, free of page UI, so importing it into the
 * plugin entry does not pull the form into the startup chunk.
 */
export function DevSpacesIcon(props: React.ComponentProps<typeof DeveloperModeIcon>) {
  return <DeveloperModeIcon {...props} />;
}
