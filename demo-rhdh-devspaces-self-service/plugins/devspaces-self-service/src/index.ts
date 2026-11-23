// RHDH 2.1 loads a frontend dynamic plugin by its default export, which must be
// a New Frontend System feature. The RHDH 2.1 CLI exposes the package root.
export { default } from './plugin';
export { rootRouteRef } from './routes';
export type { Capabilities, DevSpaceRequestInput, PlanResponse } from './api/client';
