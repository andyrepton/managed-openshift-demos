import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { readAssistantConfig } from './assistant/config';
import { loadOverrides } from './overrides';
import { createRouter } from './router';

/**
 * Backstage backend plugin wrapping the Azure price proxy.
 *
 * Backstage mounts this at `/api/aro-planner`, which is exactly the relative path
 * the wizard already calls, so the frontend needs no base-URL handling.
 *
 * The Azure Retail Prices API sends no CORS headers, so the pricing calls have to
 * be made server-side; this is where that happens inside RHDH.
 */
export const aroPlannerPlugin = createBackendPlugin({
  pluginId: 'aro-planner',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ http, logger, config }) {
        // Values Azure does not publish. Read from app-config so they can be set
        // without rebuilding the plugin; anything absent stays excluded from the
        // total and labelled, never silently counted as zero.
        const overrides = {
          ...loadOverrides(),
          ...(config.getOptionalNumber('aroPlanner.hcpControlPlanePerHour') !== undefined
            ? { hcpControlPlanePerHour: config.getOptionalNumber('aroPlanner.hcpControlPlanePerHour')! }
            : {}),
          ...(config.getOptionalNumber('aroPlanner.osDiskPerGiBMonth') !== undefined
            ? { osDiskPerGiBMonth: config.getOptionalNumber('aroPlanner.osDiskPerGiBMonth')! }
            : {}),
          ...(config.getOptionalString('aroPlanner.hcpControlPlaneNote')
            ? { hcpControlPlaneNote: config.getOptionalString('aroPlanner.hcpControlPlaneNote')! }
            : {}),
          // Rates for the models Azure does not price. Absent means the model is
          // shown as UNPRICED, which is the safe default - never zero.
          ...(config.getOptionalNumber('aroPlanner.sharedClusterPerVcpuHour') !== undefined
            ? { sharedClusterPerVcpuHour: config.getOptionalNumber('aroPlanner.sharedClusterPerVcpuHour')! }
            : {}),
          ...(config.getOptionalString('aroPlanner.sharedClusterNote')
            ? { sharedClusterNote: config.getOptionalString('aroPlanner.sharedClusterNote')! }
            : {}),
          ...(config.getOptionalNumber('aroPlanner.onPremPerVcpuHour') !== undefined
            ? { onPremPerVcpuHour: config.getOptionalNumber('aroPlanner.onPremPerVcpuHour')! }
            : {}),
          ...(config.getOptionalString('aroPlanner.onPremNote')
            ? { onPremNote: config.getOptionalString('aroPlanner.onPremNote')! }
            : {}),
        };

        if (overrides.hcpControlPlanePerHour === undefined || overrides.hcpControlPlanePerHour === null) {
          logger.info(
            'No ARO HCP control-plane fee configured; it will be excluded from estimates and flagged.',
          );
        }

        // The in-page assistant. Off unless a model endpoint is configured, and
        // it is deliberately not configured here: guest sign-in is enabled on
        // this instance, so a key would be spendable by anyone who can load the
        // page. Set aroPlanner.assistant.* once that is no longer true.
        const assistant = readAssistantConfig(config);
        logger.info(
          assistant.enabled
            ? `Planner assistant enabled against model ${assistant.model}.`
            : `Planner assistant disabled: ${assistant.disabledReason}`,
        );

        http.use(createRouter({ overrides, assistant }));
      },
    });
  },
});
