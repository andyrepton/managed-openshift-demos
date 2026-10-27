# demo-rhdh-cluster-planner

Yarn workspaces monorepo: `packages/aro-planner-common` (pure TypeScript
engine), `plugins/aro-planner` (frontend plugin), `plugins/aro-planner-backend`
(backend plugin). Keep everything pure in `aro-planner-common`, so the UI,
backend and any future MCP server import the same functions and cannot disagree
about a number. Runs on RHDH 1.10 (see `../demo-developer-hub/CLAUDE.md`).

## The ARO HCP control-plane fee is an assumption

Microsoft has not published an ARO HCP control-plane fee. The planner uses the
published **ROSA HCP figure of $0.25/hr** as a demo stand-in, labelled
`override` with `hcpControlPlaneNote` explaining where it came from, and prints
"ASSUMPTION, NOT A CONFIRMED PRICE" wherever it appears. Never let it render as
an Azure price. If Microsoft publishes a real rate, replace it and drop the
note.

## Azure Retail Prices API

`GET https://prices.azure.com/api/retail/prices`, unauthenticated.

- `serviceName eq 'Azure Red Hat OpenShift'` returns **nothing**. ARO licence
  meters live under `serviceName = 'Virtual Machines Licenses'`, with
  `productName = 'Azure Red Hat OpenShift <category>'` and `meterName` as the
  vCPU count (`'8 vCPU'`). Find them with `$filter=contains(productName,'OpenShift')`.
- The licence is a flat $0.0428/vCPU/hr on **worker cores only**.
- VM compute is a separate `serviceName eq 'Virtual Machines'` query. Filter out
  `productName` containing `Windows` and `skuName` containing `Spot` or
  `Low Priority`, or the price is silently wrong.
- **No CORS** (preflight returns 405), so the backend proxy is mandatory.
  Paginate via `NextPageLink`.
- For supported VM sizes use Microsoft's ARO support policy page, not
  `az vm list-skus`.

## Scaffolder forms cannot compute across fields

Reading sibling fields through `formContext.formData` is discouraged upstream
and buggy in `scaffolder/next` (backstage/backstage#15830). The wizard is
**one** custom field extension bound to a single object parameter, holding all
state in its own React component and emitting one object via `onChange`. The
same component is mounted as a standalone page.

## Building and loading dynamic plugins (RHDH 1.10)

- Use the CLI matching the RHDH version: `@red-hat-developer-hub/cli@release-1.10`,
  not `@latest` (2.x).
- The plugin registry image must be `FROM scratch`. RHDH treats layer 0 as the
  plugin tarball; with a base image the install reports success and leaves an
  empty plugin directory.
- `oci://<image>:<tag>!<plugin-dir-name>` names the path explicitly, so a plain
  OpenShift `BuildConfig` (`oc start-build --from-dir=plugin-registry`) can
  build the image.
- The key under `dynamicPlugins.frontend` must equal `scalprum.name` in the
  plugin's `package.json`, or the plugin is discovered and never loaded.
- Build traps: declarations go under `dist-types/<package-path>/` at the
  workspace root; Backstage 1.49 uses the classic JSX runtime, so every `.tsx`
  needs `import React`; relative imports must be extensionless; add
  `"resolutions": {"got": "11.8.2"}`; override tsconfig `types: ["node"]`;
  `@backstage/dev-utils` is unusable outside the Backstage monorepo; embed
  workspace packages with `plugin export --embed-package`, with `exports` as a
  string, not a conditional object.
- MUI `Select` renders options as plain text inside a scalprum bundle. Use
  `SelectProps={{ native: true }}` with `<option>`.
- Reach the backend via `discoveryApi.getBaseUrl(pluginId)` and
  `fetchApi.fetch`. A bare relative `fetch` gets 401 (or 404 if the backend
  plugin is not installed).
- Verify with `/api/dynamic-plugins-info/loaded-plugins` (needs a backend token).
