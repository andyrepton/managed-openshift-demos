import { describe, expect, it } from 'vitest';

import { bundleName, emitBundle } from '../src/emit/index.js';
import type { EmitInput } from '../src/emit/types.js';
import { compareModels } from '../src/compare.js';
import { planNetworkPolicies } from '../src/netpol.js';
import { getSku } from '../src/skus.js';
import type { ClusterPlan, DeploymentModel, NodePoolPlan, SizingRequest } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

function pool(name: string, nodes: number): NodePoolPlan {
  const sku = getSku(name, 'worker')!;
  return {
    sku,
    nodes,
    totalVcpu: sku.vcpu * nodes,
    totalRamGiB: sku.ramGiB * nodes,
    allocatableVcpu: (sku.vcpu - 1) * nodes,
    allocatableRamGiB: (sku.ramGiB - 4) * nodes,
    waste: 0.11,
    rationale: ['Fewest nodes that fit', 'Per-node overhead amortised over three nodes'],
  };
}

const p = pool('Standard_D16s_v5', 3);

function input(over: Partial<SizingRequest> = {}, flavour: 'hcp' | 'classic' = 'hcp'): EmitInput {
  const request: SizingRequest = {
    flavour,
    region: 'westeurope',
    vcpu: 40,
    ramGiB: 160,
    profile: 'general',
    highAvailability: true,
    dayTwo: false,
    applicationName: 'payments-api',
    deploymentModel: 'dedicated-cluster',
    ...over,
  };
  // Classic ARO is costed with three control plane nodes, charged as infrastructure
  // but never licensed, so the plan has to name their size.
  const controlPlaneSku = getSku('Standard_D8s_v5', 'control-plane')!;
  const plan: ClusterPlan = {
    flavour,
    region: 'westeurope',
    workerPools: [p],
    ...(flavour === 'classic' ? { controlPlaneSku } : {}),
  };
  return {
    request,
    plan,
    pool: p,
    comparison: compareModels(request, { prices: WESTEUROPE_PRICES, dedicated: { plan, pool: p } }),
    networkPlan: planNetworkPolicies({
      namespace: 'payments-api',
      endpoints: [
        { name: 'Public web', direction: 'ingress', target: { kind: 'internet' } },
        {
          name: 'Oracle on-prem',
          direction: 'egress',
          target: { kind: 'on-premises', cidrs: ['10.20.0.0/16'] },
          ports: [{ protocol: 'TCP', port: 1521 }],
        },
      ],
    }),
    prices: { retrievedAt: '2026-10-12T00:00:00Z' },
    generatedAt: '2026-10-12',
  };
}

const paths = (i: EmitInput) => emitBundle(i).files.map(f => f.path);
const file = (i: EmitInput, path: string) =>
  emitBundle(i).files.find(f => f.path === path)?.contents;

describe('bundleName', () => {
  it.each([
    ['payments-api', 'payments-api'],
    ['Payments API (prod)', 'payments-api-prod'],
    ['  ', 'my-application'],
    [undefined, 'my-application'],
    ['!!!', 'my-application'],
  ])('%j -> %s', (given, expected) => {
    expect(bundleName(given)).toBe(expected);
  });

  it('never ends in a hyphen, which the API server rejects', () => {
    // Same trap as the NetworkPolicy slug: a name the regex accepts but the API
    // server does not.
    expect(bundleName('Payments API (prod)')).not.toMatch(/-$/);
    expect(bundleName('x'.repeat(80))).not.toMatch(/-$/);
  });
});

describe('what each deployment model emits', () => {
  it('a dedicated HCP cluster gets a tfvars', () => {
    expect(paths(input())).toContain('payments-api.tfvars');
  });

  it.each<DeploymentModel>(['shared-namespace', 'on-premises'])(
    '%s gets no tfvars, because it creates no infrastructure',
    model => {
      expect(paths(input({ deploymentModel: model }))).not.toContain('payments-api.tfvars');
    },
  );

  it('every model still gets a plan, manifests and a catalog entry', () => {
    for (const model of ['shared-namespace', 'dedicated-cluster', 'on-premises'] as const) {
      const got = paths(input({ deploymentModel: model }));
      expect(got).toEqual(
        expect.arrayContaining([
          'plan.md',
          'catalog-info.yaml',
          'manifests/00-namespace.yaml',
          'manifests/10-quota.yaml',
          'manifests/20-networkpolicies.yaml',
        ]),
      );
    }
  });

  it('only classic ARO gets a MachineSet - HCP pools live in the tfvars', () => {
    expect(paths(input({}, 'classic'))).toContain('manifests/30-machineset.yaml');
    expect(paths(input({}, 'hcp'))).not.toContain('manifests/30-machineset.yaml');
  });

  it('a shared namespace gets no MachineSet even on classic', () => {
    expect(paths(input({ deploymentModel: 'shared-namespace' }, 'classic'))).not.toContain(
      'manifests/30-machineset.yaml',
    );
  });

  it('is deterministic', () => {
    expect(emitBundle(input())).toEqual(emitBundle(input()));
  });
});

describe('tfvars', () => {
  const tf = () => file(input(), 'payments-api.tfvars')!;

  it('sets every create flag explicitly, with exactly one true', () => {
    // The root module shares one state across four providers. A tfvars that omits
    // a flag plans a destroy against whatever that flag defaults to.
    const body = tf();
    expect(body).toContain('create_aro_hcp = true');
    expect(body).toContain('create_aro     = false');
    expect(body).toContain('create_rosa    = false');
    expect(body).toContain('create_osd     = false');
    expect(body.match(/^create_\w+\s*=\s*true$/gm)).toHaveLength(1);
  });

  it('spreads a HA pool across three zones, since each pool pins one zone', () => {
    const body = tf();
    expect(body).toContain('np-1 = {');
    expect(body).toContain('np-3 = {');
    expect(body).toContain('replicas          = 1');
    expect(body).toContain('vm_size           = "Standard_D16s_v5"');
  });

  it('splits the node count across the zones without inventing nodes', () => {
    // HA rounds the node count up to a multiple of three, so the per-zone split
    // is exact. If that ever stops being true this over-provisions silently.
    const big = file(input({ vcpu: 120, ramGiB: 480 }), 'payments-api.tfvars')!;
    const replicas = [...big.matchAll(/replicas\s+= (\d+)/g)].map(m => Number(m[1]));
    const nodes = Number(/(\d+) x Standard/.exec(file(input({ vcpu: 120, ramGiB: 480 }), 'plan.md')!)![1]);
    expect(replicas.reduce((a, b) => a + b, 0)).toBe(nodes);
  });

  it('uses a single pool when HA is off', () => {
    const body = file(input({ highAvailability: false }), 'payments-api.tfvars')!;
    expect(body).toContain('np-1 = {');
    expect(body).not.toContain('np-2 = {');
    expect(body).toContain('replicas          = 3');
  });

  it('carries the visibility the connectivity implies', () => {
    // Public ingress was requested, so ingress is Public; the API stays Private
    // because nobody asked for it to be exposed.
    const body = tf();
    expect(body).toContain('aro_hcp_ingress_visibility = "Public"');
    expect(body).toContain('aro_hcp_api_visibility     = "Private"');
  });

  it('says that classic ARO sizes workers through a MachineSet, not a variable', () => {
    const body = file(input({}, 'classic'), 'payments-api.tfvars')!;
    expect(body).toContain('create_aro     = true');
    expect(body).toMatch(/Worker sizing is NOT set here/);
    expect(body).toContain('3 x Standard_D16s_v5');
  });

  it('warns against merging it with another cluster tfvars', () => {
    expect(tf()).toMatch(/Do not merge it with another cluster/);
  });

  describe('the two version variables, which take different shapes', () => {
    // cluster_version is an X.Y stream; node_pool_version needs a full X.Y.Z.
    // Writing the same string to both yields a node pool version Terraform rejects.
    it('writes only the stream for the cluster, from a full version', () => {
      const body = file(input({ openshiftVersion: '4.22.13' }), 'payments-api.tfvars')!;
      expect(body).toContain('aro_hcp_cluster_version    = "4.22"');
      expect(body).toContain('aro_hcp_node_pool_version  = "4.22.13"');
    });

    it('omits the node pool version when no patch was asked for', () => {
      const body = file(input({ openshiftVersion: '4.22' }), 'payments-api.tfvars')!;
      expect(body).toContain('aro_hcp_cluster_version    = "4.22"');
      expect(body).not.toMatch(/^aro_hcp_node_pool_version/m);
      expect(body).toMatch(/needs a full X\.Y\.Z/);
    });

    it('defaults to the 4.22 stream and no node pool pin', () => {
      const body = tf();
      expect(body).toContain('aro_hcp_cluster_version    = "4.22"');
      expect(body).not.toMatch(/^aro_hcp_node_pool_version/m);
    });
  });
});

describe('manifests', () => {
  it('quotas at exactly what was costed', () => {
    const body = file(input(), 'manifests/10-quota.yaml')!;
    expect(body).toContain("requests.cpu: '40'");
    expect(body).toContain('limits.memory: 160Gi');
    expect(body).toContain('kind: LimitRange');
  });

  it('uses a ClusterResourceQuota selecting the application label', () => {
    // Per-namespace ResourceQuotas silently double the entitlement each time a
    // team adds a namespace. Selecting on a label keeps one pot per application.
    const body = file(input(), 'manifests/10-quota.yaml')!;
    expect(body).toContain('apiVersion: quota.openshift.io/v1');
    expect(body).toContain('kind: ClusterResourceQuota');
    expect(body).toContain('matchLabels:');
    expect(body).toContain('aro-planner.redhat.com/application: payments-api');
    expect(body).not.toContain('kind: ResourceQuota');
    // Cluster-scoped: a namespace here would be rejected by the API server.
    expect(/kind: ClusterResourceQuota[\s\S]*?namespace:/.exec(body.split('---')[0]!)).toBeNull();
  });

  it('labels the namespace so the quota selects it', () => {
    expect(file(input(), 'manifests/00-namespace.yaml')).toContain(
      'aro-planner.redhat.com/application: payments-api',
    );
  });

  it('leaves storage out of the quota when none was asked for', () => {
    // requests.storage of 0 would block every PVC - a confusing way to discover
    // the field was left blank.
    const body = file(input(), 'manifests/10-quota.yaml')!;
    expect(body).not.toContain('requests.storage');
    expect(body).not.toContain('persistentvolumeclaims');
  });

  it('constrains storage when some was asked for', () => {
    const i = input({ storageGiB: 300 });
    const body = file(i, 'manifests/10-quota.yaml')!;
    expect(body).toContain('requests.storage: 300Gi');
    expect(body).toContain("persistentvolumeclaims: '20'");
  });

  it('needs no StorageClass for Premium, which is the ARO default', () => {
    // ARO ships managed-csi (Premium_LRS) and nothing else. Emitting a class
    // for it would be noise.
    const paths = emitBundle(input({ storageGiB: 300, storageTier: 'premium-ssd' })).files.map(f => f.path);
    expect(paths).not.toContain('manifests/05-storageclass.yaml');
  });

  it('emits a StorageClass for Standard SSD, which ARO does not provide', () => {
    // Without this the PVCs land on Premium via managed-csi and cost more than
    // the estimate says - priced as Standard, provisioned as Premium.
    const i = input({ storageGiB: 300, storageTier: 'standard-ssd' });
    const body = file(i, 'manifests/05-storageclass.yaml')!;
    expect(body).toContain('kind: StorageClass');
    expect(body).toContain('name: managed-csi-standard');
    expect(body).toContain('skuName: StandardSSD_LRS');
    expect(body).toContain('provisioner: disk.csi.azure.com');
    expect(body).toContain('volumeBindingMode: WaitForFirstConsumer');
    expect(body).toMatch(/CLUSTER-SCOPED/);
  });

  it('scopes the storage quota to the class that was costed', () => {
    const body = file(input({ storageGiB: 300, storageTier: 'standard-ssd' }), 'manifests/10-quota.yaml')!;
    expect(body).toContain('managed-csi-standard.storageclass.storage.k8s.io/requests.storage');
  });

  it('emits no StorageClass when no storage was asked for', () => {
    const paths = emitBundle(input({ storageTier: 'standard-ssd' })).files.map(f => f.path);
    expect(paths).not.toContain('manifests/05-storageclass.yaml');
  });

  it('says the quota is cluster-scoped and needs an admin', () => {
    expect(file(input(), 'manifests/10-quota.yaml')).toMatch(/CLUSTER-SCOPED/);
  });

  it('names the namespace after the application', () => {
    const body = file(input(), 'manifests/00-namespace.yaml')!;
    expect(body).toContain('name: payments-api');
    expect(body).toContain('kubernetes.io/metadata.name: payments-api');
  });

  it('writes every generated policy, with the caveats as comments', () => {
    const i = input();
    const body = file(i, 'manifests/20-networkpolicies.yaml')!;
    for (const p2 of i.networkPlan.policies) expect(body).toContain(`name: ${p2.metadata.name}`);
    expect(body.match(/^kind: NetworkPolicy$/gm)).toHaveLength(i.networkPlan.policies.length);
  });

  it('leaves the MachineSet infrastructure ID as a placeholder', () => {
    // It cannot be known before the cluster exists, and a guess applies cleanly
    // then silently creates no machines.
    const body = file(input({}, 'classic'), 'manifests/30-machineset.yaml')!;
    expect(body).toContain('REPLACE_ME_INFRA_ID');
    expect(body).toMatch(/oc get infrastructure cluster/);
    expect(body).toContain('vmSize: Standard_D16s_v5');
  });
});

describe('plan.md', () => {
  const md = (over: Partial<SizingRequest> = {}) => file(input(over), 'plan.md')!;

  it('marks the derived figures as assumptions and the Azure one as metered', () => {
    const body = md();
    expect(body).toMatch(/Only the dedicated ARO cluster is priced from a real meter/);
    expect(body).toMatch(/\| Metered \|/);
    expect(body).toMatch(/~\$[\d,]+\.\d\d\/month \| Assumed \|/);
  });

  it('marks the chosen model', () => {
    expect(md()).toMatch(/Dedicated ARO cluster \*\*\(chosen\)\*\*/);
  });

  it('records the runners-up when there are any', () => {
    const i = { ...input(), alternatives: [pool('Standard_D8s_v5', 6)] };
    const body = file(i, 'plan.md')!;
    expect(body).toContain('Also considered:');
    expect(body).toContain('6 x Standard_D8s_v5');
  });

  it('tells an on-premises request there is nothing to provision in Azure', () => {
    const body = md({ deploymentModel: 'on-premises' });
    expect(body).toMatch(/nothing to provision in Azure/);
    expect(body).not.toContain('terraform plan');
  });

  it('tells a shared namespace to check the cluster has headroom', () => {
    expect(md({ deploymentModel: 'shared-namespace' })).toMatch(/has that much headroom/);
  });

  it('surfaces what NetworkPolicy cannot express', () => {
    const i: EmitInput = {
      ...input(),
      networkPlan: planNetworkPolicies({
        namespace: 'payments-api',
        endpoints: [
          { name: 'Azure SQL', direction: 'egress', target: { kind: 'azure-service', service: 'sql' } },
        ],
      }),
    };
    expect(file(i, 'plan.md')).toMatch(/What NetworkPolicy cannot do here/);
  });

  it('escapes a pipe so the markdown tables survive it', () => {
    const body = file(input({ applicationName: 'a|b' }), 'plan.md')!;
    expect(body).toContain('a\\|b');
  });
});
