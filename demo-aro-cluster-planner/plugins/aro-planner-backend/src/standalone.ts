#!/usr/bin/env node
/**
 * Standalone dev server.
 *
 * Runs the same Express router that will later be mounted as a Backstage backend
 * plugin, so the wizard can be developed with `yarn dev` and no RHDH instance.
 *
 *   yarn workspace @aro-planner/backend start
 *   curl localhost:7008/api/aro-planner/health
 */
import express from 'express';

import { createRouter } from './router.js';
import { loadOverrides } from './overrides.js';

const PORT = Number(process.env.PORT ?? 7008);
const MOUNT = '/api/aro-planner';

const app = express();

// The wizard dev server runs on a different port, so it needs CORS. The real
// Backstage mount is same-origin and never hits this.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const overrides = loadOverrides();
app.use(MOUNT, createRouter({ overrides }));

app.listen(PORT, () => {
  console.log(`aro-planner backend listening on http://localhost:${PORT}${MOUNT}`);
  console.log(`  health: http://localhost:${PORT}${MOUNT}/health`);
  if (overrides.hcpControlPlanePerHour === null || overrides.hcpControlPlanePerHour === undefined) {
    console.log('  note: no ARO HCP control-plane fee configured - it will be excluded and flagged.');
  }
});
