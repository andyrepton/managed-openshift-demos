import React from 'react';

import { Content } from '@backstage/core-components';

import { Wizard } from './Wizard';

/**
 * Standalone page: price a cluster without starting a Scaffolder request.
 *
 * Content only. In the New Frontend System the page extension's `title` renders
 * the header, so a `Page`/`Header` shell here would draw a second one.
 */
export function PlannerPage() {
  return (
    <Content>
      <Wizard />
    </Content>
  );
}
