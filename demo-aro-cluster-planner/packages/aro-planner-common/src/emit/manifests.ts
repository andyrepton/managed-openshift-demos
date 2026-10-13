import { storageClassFor } from '../storage.js';
import { toYaml, toYamlDocuments, type YamlValue } from './yaml.js';
import type { EmitFile, EmitInput } from './types.js';

/**
 * Day-2 manifests for the namespace a request creates.
 *
 * Everything here is scoped to one namespace and is safe to apply to a cluster
 * that already exists. Cluster-scoped shape - how many nodes, what size, what
 * visibility - belongs in the tfvars, not here, because applying it needs a
 * cluster admin and a Terraform run, not `oc apply`.
 */

const LABEL_PREFIX = 'aro-planner.redhat.com';

/** Labels tying everything back to the request that generated it. */
function commonLabels(name: string, input: EmitInput): Record<string, string> {
  return {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/managed-by': 'aro-planner',
    [`${LABEL_PREFIX}/deployment-model`]: input.request.deploymentModel ?? 'dedicated-cluster',
  };
}

function namespaceManifest(name: string, input: EmitInput): YamlValue {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      labels: {
        ...commonLabels(name, input),
        // Required for the monitoring and ingress baseline NetworkPolicies to
        // select this namespace from the other side.
        'kubernetes.io/metadata.name': name,
        // What the ClusterResourceQuota selects on. Label a second namespace
        // with this and it shares the same quota rather than getting its own.
        [`${LABEL_PREFIX}/application`]: name,
      },
      annotations: {
        'openshift.io/display-name': input.request.applicationName ?? name,
        [`${LABEL_PREFIX}/requested-vcpu`]: String(input.request.vcpu),
        [`${LABEL_PREFIX}/requested-ram-gib`]: String(input.request.ramGiB),
      },
    },
  };
}

/**
 * A quota at exactly what was asked for, and therefore at exactly what was priced.
 *
 * A ClusterResourceQuota rather than a ResourceQuota, selecting on a label, so
 * the budget follows the APPLICATION rather than a single namespace. A team that
 * later wants `payments-api-staging` labels it and the two share one pot -
 * whereas a per-namespace ResourceQuota silently doubles the entitlement every
 * time someone adds a namespace, which is how a costed request stops matching
 * what is actually running.
 *
 * It is cluster-scoped, so applying it needs a cluster admin. That is the point:
 * the quota is the platform team's control, not the requesting team's.
 *
 * Limits equal requests on purpose. The costing bought capacity for the stated
 * vCPU and RAM; letting limits exceed that would let the namespace burst into
 * capacity nobody paid for, and the first anyone would know is a pending pod on
 * a full cluster.
 */
function clusterResourceQuotaManifest(name: string, input: EmitInput): YamlValue {
  const { vcpu, ramGiB } = input.request;
  const hard: Record<string, string> = {
    'requests.cpu': String(vcpu),
    'requests.memory': `${ramGiB}Gi`,
    'limits.cpu': String(vcpu),
    'limits.memory': `${ramGiB}Gi`,
    'count/services.loadbalancers': '2',
  };

  // Capped at what was ASKED FOR, not at the provisioned tier. A 300 GiB
  // request is billed as a 512 GiB disk, but 300 is the team's entitlement -
  // the difference is waste the estimate already calls out, not headroom.
  //
  // Only set when some storage was asked for: `requests.storage: 0` blocks
  // every PVC, which is a very confusing way to discover the field was blank.
  const storageGiB = input.request.storageGiB ?? 0;
  if (storageGiB > 0) {
    const sc = storageClassFor(input.request.storageTier ?? 'premium-ssd');
    hard['requests.storage'] = `${storageGiB}Gi`;
    // Also scoped to the class, so the budget cannot be spent on a dearer tier
    // than the one that was costed.
    hard[`${sc.name}.storageclass.storage.k8s.io/requests.storage`] = `${storageGiB}Gi`;
    // A ceiling on volume count, not capacity. It exists because each PVC is a
    // separate managed disk billed at its own tier, so many small volumes cost
    // more than the estimate assumes.
    hard.persistentvolumeclaims = '20';
  }

  return {
    apiVersion: 'quota.openshift.io/v1',
    kind: 'ClusterResourceQuota',
    metadata: { name: `${name}-quota`, labels: commonLabels(name, input) },
    spec: {
      selector: {
        labels: {
          matchLabels: { [`${LABEL_PREFIX}/application`]: name },
        },
      },
      quota: { hard },
    },
  };
}

/**
 * Defaults so a pod without explicit resources still lands somewhere sane.
 *
 * With a ResourceQuota on requests, a pod that sets none is rejected outright
 * rather than defaulted - a LimitRange is what stops that being everyone's first
 * experience of the namespace.
 */
function limitRangeManifest(name: string, input: EmitInput): YamlValue {
  return {
    apiVersion: 'v1',
    kind: 'LimitRange',
    metadata: { name: `${name}-limits`, namespace: name, labels: commonLabels(name, input) },
    spec: {
      limits: [
        {
          type: 'Container',
          default: { cpu: '500m', memory: '512Mi' },
          defaultRequest: { cpu: '100m', memory: '128Mi' },
          max: { cpu: String(input.request.vcpu), memory: `${input.request.ramGiB}Gi` },
        },
      ],
    },
  };
}

/**
 * A worker MachineSet, for classic ARO only.
 *
 * HCP node pools are declared in Terraform - see the tfvars - so this is emitted
 * only for the standard architecture, where scaling is a cluster-side object.
 *
 * The infrastructure ID cannot be known before the cluster exists, so it is left
 * as a placeholder with the command to fill it in. Emitting a guess would produce
 * a MachineSet that applies cleanly and never creates a machine.
 */
function machineSetManifest(name: string, input: EmitInput, zone: string, replicas: number): YamlValue {
  const infra = 'REPLACE_ME_INFRA_ID';
  const msName = `${infra}-${name}-${zone}`;
  return {
    apiVersion: 'machine.openshift.io/v1beta1',
    kind: 'MachineSet',
    metadata: {
      name: msName,
      namespace: 'openshift-machine-api',
      labels: { 'machine.openshift.io/cluster-api-cluster': infra },
    },
    spec: {
      replicas,
      selector: {
        matchLabels: {
          'machine.openshift.io/cluster-api-cluster': infra,
          'machine.openshift.io/cluster-api-machineset': msName,
        },
      },
      template: {
        metadata: {
          labels: {
            'machine.openshift.io/cluster-api-cluster': infra,
            'machine.openshift.io/cluster-api-machine-role': 'worker',
            'machine.openshift.io/cluster-api-machine-type': 'worker',
            'machine.openshift.io/cluster-api-machineset': msName,
          },
        },
        spec: {
          metadata: { labels: { [`${LABEL_PREFIX}/pool`]: name } },
          providerSpec: {
            value: {
              apiVersion: 'machine.openshift.io/v1beta1',
              kind: 'AzureMachineProviderSpec',
              credentialsSecret: { name: 'azure-cloud-credentials', namespace: 'openshift-machine-api' },
              location: input.request.region,
              zone,
              vmSize: input.pool?.sku.name ?? 'REPLACE_ME_VM_SIZE',
              osDisk: { diskSizeGB: 128, managedDisk: { storageAccountType: 'Premium_LRS' }, osType: 'Linux' },
              image: { resourceID: 'REPLACE_ME_IMAGE_RESOURCE_ID' },
              networkResourceGroup: 'REPLACE_ME_NETWORK_RESOURCE_GROUP',
              vnet: 'REPLACE_ME_VNET',
              subnet: 'REPLACE_ME_WORKER_SUBNET',
              publicIP: false,
              resourceGroup: 'REPLACE_ME_CLUSTER_RESOURCE_GROUP',
              userDataSecret: { name: 'worker-user-data' },
            },
          },
        },
      },
    },
  };
}

const STORAGECLASS_HEADER = `# A StorageClass for the chosen disk tier.
#
# ARO ships exactly one disk class - \`managed-csi\`, which is Premium_LRS and the
# cluster default. Standard SSD has to be created, and this is CLUSTER-SCOPED so
# it needs an admin. Without it the PVCs land on Premium and cost more than the
# estimate says.
#
# Safe to skip if a class of this name already exists.
`;

function storageClassManifest(sc: ReturnType<typeof storageClassFor>): YamlValue {
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: sc.name },
    provisioner: 'disk.csi.azure.com',
    parameters: { skuName: sc.skuName },
    reclaimPolicy: 'Delete',
    // Matches managed-csi: bind only once a pod is scheduled, so the disk is
    // created in the zone the pod actually lands in.
    volumeBindingMode: 'WaitForFirstConsumer',
    allowVolumeExpansion: true,
  };
}

const QUOTA_HEADER = `# Capacity budget for this application.
#
# The ClusterResourceQuota is CLUSTER-SCOPED and needs a cluster admin to apply.
# It selects namespaces by label, so the budget follows the application: label a
# second namespace with the same value and the two share one pot rather than
# each getting a full entitlement of its own.
#
# The LimitRange below is namespaced and must exist in every namespace the quota
# covers - without it, a pod that sets no resources is rejected outright rather
# than defaulted, which is a poor first experience of a new namespace.
`;

const MACHINESET_HEADER = `# Worker MachineSets for classic ARO.
#
# Fill the REPLACE_ME values in from the live cluster - they do not exist until it
# does. A MachineSet with the wrong infrastructure ID applies without error and
# then never creates a machine, so check these before applying:
#
#   oc get infrastructure cluster -o jsonpath='{.status.infrastructureName}'
#   oc -n openshift-machine-api get machineset -o yaml   # copy image/vnet/subnet
#
# ARO HCP does not use MachineSets. Its node pools are in the tfvars instead.
`;

/** A Backstage Component so the namespace appears in the software catalog. */
function catalogInfo(name: string, input: EmitInput): YamlValue {
  const chosen = input.comparison.find(c => c.model === input.request.deploymentModel);
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name,
      description:
        `${input.request.vcpu} vCPU / ${input.request.ramGiB} GiB on ` +
        `${chosen?.label ?? 'an unspecified deployment model'}.`,
      annotations: {
        [`${LABEL_PREFIX}/deployment-model`]: input.request.deploymentModel ?? 'dedicated-cluster',
        [`${LABEL_PREFIX}/region`]: input.request.region,
      },
      tags: ['openshift', input.request.deploymentModel ?? 'dedicated-cluster'],
    },
    spec: {
      type: 'service',
      lifecycle: 'experimental',
      owner: input.owner ?? 'guests',
    },
  };
}

export function renderManifests(name: string, input: EmitInput): EmitFile[] {
  const dir = `manifests`;
  const files: EmitFile[] = [
    {
      path: `${dir}/00-namespace.yaml`,
      contents: `${toYaml(namespaceManifest(name, input))}\n`,
    },
    {
      path: `${dir}/10-quota.yaml`,
      contents:
        QUOTA_HEADER +
        toYamlDocuments([
          clusterResourceQuotaManifest(name, input),
          limitRangeManifest(name, input),
        ]),
    },
    {
      path: `${dir}/20-networkpolicies.yaml`,
      contents: renderNetworkPolicies(input),
    },
  ];

  // Classic ARO only. HCP pools live in the tfvars, and neither a shared namespace
  // nor an on-premises request creates worker nodes here at all.
  if (input.request.deploymentModel === 'dedicated-cluster' && input.request.flavour === 'classic' && input.pool) {
    const zones = input.request.highAvailability ? ['1', '2', '3'] : ['1'];
    const per = Math.ceil(input.pool.nodes / zones.length);
    files.push({
      path: `${dir}/30-machineset.yaml`,
      contents:
        MACHINESET_HEADER +
        toYamlDocuments(zones.map(z => machineSetManifest(name, input, z, per))),
    });
  }

  // ARO provides only `managed-csi` (Premium_LRS). Anything else has to be
  // created, or the PVCs silently land on Premium and the estimate is wrong.
  const sc = storageClassFor(input.request.storageTier ?? 'premium-ssd');
  if ((input.request.storageGiB ?? 0) > 0 && sc.mustCreate) {
    files.push({
      path: `${dir}/05-storageclass.yaml`,
      contents: STORAGECLASS_HEADER + `${toYaml(storageClassManifest(sc))}\n`,
    });
  }

  files.push({ path: 'catalog-info.yaml', contents: `${toYaml(catalogInfo(name, input))}\n` });
  return files;
}

function renderNetworkPolicies(input: EmitInput): string {
  const { policies, caveats } = input.networkPlan;
  const header = [
    '# NetworkPolicies for this namespace.',
    '#',
    '# A default-deny baseline, then the minimum OpenShift itself needs, then one',
    '# rule per connection that was asked for. Apply the whole file - the baseline',
    '# without the DNS and ingress rules breaks every pod in the namespace.',
  ];
  if (caveats.length > 0) {
    header.push(
      '#',
      '# NOT EXPRESSIBLE AS NETWORKPOLICY - these still need doing by hand:',
      ...caveats.map(c => `#   - ${c}`),
    );
  }
  return `${header.join('\n')}\n${toYamlDocuments(policies as unknown as YamlValue[])}`;
}
