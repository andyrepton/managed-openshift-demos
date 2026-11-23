import React from 'react';

import { Content } from '@backstage/core-components';

import { RequestForm } from './RequestForm';

/**
 * Content only. In the New Frontend System the page extension's `title` renders
 * the header, so a `Page`/`Header` shell here would draw a second one.
 */
export function RequestPage() {
  return (
    <Content>
      <RequestForm />
    </Content>
  );
}
