import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { createRouter } from './router';

/**
 * Backend for the Dev Spaces self-service plugin.
 *
 * Mounted at `/api/devspaces-self-service`. Unlike the other plugin in this
 * repo, this one writes to the cluster, so two things are logged loudly at
 * startup: whether it has a credential at all, and whether the in-cluster AI
 * option is available. Both are the difference between a form that works and
 * a form that fails on submit with something unhelpful.
 */
export const devspacesSelfServicePlugin = createBackendPlugin({
  pluginId: 'devspaces-self-service',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
      },
      async init({ http, logger, config, httpAuth, userInfo }) {
        const root = 'devspacesSelfService';

        // The in-cluster model endpoint belongs to demo-vllm-model-serving,
        // which may not be deployed. Absent means the option is not offered,
        // rather than offered and broken.
        const inClusterAiBaseUrl = config.getOptionalString(`${root}.inClusterAiBaseUrl`);
        logger.info(
          inClusterAiBaseUrl
            ? `In-cluster AI endpoint configured: ${inClusterAiBaseUrl}`
            : `No ${root}.inClusterAiBaseUrl configured; the in-cluster AI option is hidden. ` +
                'Deploy demo-vllm-model-serving and set it to enable that path.',
        );

        // The namespace-creating credential. Deliberately not the pod's own
        // ServiceAccount, which every other plugin in the pod shares.
        const credentialDir = config.getOptionalString(`${root}.credentialDir`);
        logger.info(
          credentialDir
            ? `Using the provisioner credential mounted at ${credentialDir}.`
            : "No devspacesSelfService.credentialDir set, so the pod's own ServiceAccount " +
                'will be used. It almost certainly cannot create namespaces; apply ' +
                'rbac/provisioner.yaml and mount the token.',
        );

        const devfileRepoUrl = config.getOptionalString(`${root}.devfileRepoUrl`);
        const devfilePath = config.getOptionalString(`${root}.devfilePath`);

        /**
         * The caller, from credentials Backstage has verified.
         *
         * `allow: ['user']` rejects service-to-service tokens outright: this
         * endpoint provisions on behalf of a person and there is no person
         * behind a service token. Any failure resolves to undefined, which
         * the router turns into a 401 rather than guessing.
         */
        const identify = async (req: Parameters<typeof httpAuth.credentials>[0]) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user'] });
            const info = await userInfo.getUserInfo(credentials);
            return info.userEntityRef;
          } catch {
            return undefined;
          }
        };

        http.use(
          createRouter({
            identify,
            ...(credentialDir ? { credentialDir } : {}),
            ...(inClusterAiBaseUrl ? { inClusterAiBaseUrl } : {}),
            ...(devfileRepoUrl ? { devfileRepoUrl } : {}),
            ...(devfilePath ? { devfilePath } : {}),
            logger: {
              info: (m: string) => logger.info(m),
              warn: (m: string) => logger.warn(m),
            },
          }),
        );
      },
    });
  },
});
