import React from 'react';

import { Content, Header, Page } from '@backstage/core-components';

import { Wizard } from './Wizard';

/** Standalone page: price a cluster without starting a Scaffolder request. */
export function PlannerPage() {
  return (
    <Page themeId="tool">
      <Header
        title="Deployment Planner"
        subtitle="Size, price and compare where an application should run"
      />
      <Content>
        <Wizard />
      </Content>
    </Page>
  );
}
