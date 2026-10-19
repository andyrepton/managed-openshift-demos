import React from 'react';

import { Content, Header, Page } from '@backstage/core-components';

import { RequestForm } from './RequestForm';

export function RequestPage() {
  return (
    <Page themeId="tool">
      <Header
        title="Request a Dev Space"
        subtitle="A namespace, a quota and a workspace definition, in your name"
      />
      <Content>
        <RequestForm />
      </Content>
    </Page>
  );
}
