import { describe, expect, it } from 'vitest';

import {
  baselinePolicies,
  clusterSettingsFor,
  planNetworkPolicies,
  type EndpointRequest,
} from '../src/netpol.js';

const NS = 'payments-dev';
const names = (p: { metadata: { name: string } }[]) => p.map(x => x.metadata.name);

describe('baseline', () => {
  it('denies everything by default', () => {
    const deny = baselinePolicies(NS).find(p => p.metadata.name === 'default-deny-all');
    expect(deny?.spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(deny?.spec.podSelector).toEqual({});
  });

  it('always allows DNS egress on both ports', () => {
    // Omitting this is the classic mistake: every pod fails name resolution and the
    // cause is invisible from the application logs.
    const dns = baselinePolicies(NS).find(p => p.metadata.name === 'allow-dns-egress');
    const egress = dns!.spec.egress as { ports: { port: number }[] }[];
    expect(new Set(egress[0]!.ports.map(p => p.port))).toEqual(new Set([53, 5353]));
  });

  it('allow-same-namespace opens BOTH directions, or pod-to-pod silently fails', () => {
    // Ingress alone lets the receiver accept while default-deny-all still blocks
    // the sender's egress. The policy would be named for something it did not do.
    const p = baselinePolicies(NS).find(x => x.metadata.name === 'allow-same-namespace')!;
    expect(p.spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(p.spec.ingress).toBeDefined();
    expect(p.spec.egress).toBeDefined();
  });

  it('lets Prometheus scrape the namespace', () => {
    expect(names(baselinePolicies(NS))).toContain('allow-from-openshift-monitoring');
  });

  it('scopes every policy to the requested namespace', () => {
    expect(baselinePolicies(NS).every(p => p.metadata.namespace === NS)).toBe(true);
  });
});

describe('endpoints', () => {
  it('routes public ingress through the OpenShift router, not raw internet', () => {
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [{ name: 'web', direction: 'ingress', target: { kind: 'internet' }, ports: [{ protocol: 'TCP', port: 8080 }] }],
    });
    const p = plan.policies.find(x => x.metadata.name === 'allow-ingress-web')!;
    const from = (p.spec.ingress as { from: { namespaceSelector?: { matchLabels: Record<string, string> } }[] }[])[0]!.from;
    expect(from[0]!.namespaceSelector!.matchLabels).toHaveProperty(
      'policy-group.network.openshift.io/ingress',
    );
  });

  it('excludes RFC1918 from internet egress so it cannot reach private networks', () => {
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [{ name: 'api', direction: 'egress', target: { kind: 'internet' } }],
    });
    const p = plan.policies.find(x => x.metadata.name === 'allow-egress-api')!;
    const to = (p.spec.egress as { to: { ipBlock: { cidr: string; except: string[] } }[] }[])[0]!.to;
    expect(to[0]!.ipBlock.cidr).toBe('0.0.0.0/0');
    expect(to[0]!.ipBlock.except).toContain('10.0.0.0/8');
  });

  it('emits ipBlock rules for on-premises CIDRs', () => {
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [
        {
          name: 'oracle',
          direction: 'egress',
          target: { kind: 'on-premises', cidrs: ['192.168.10.0/24'] },
          ports: [{ protocol: 'TCP', port: 1521 }],
        },
      ],
    });
    const p = plan.policies.find(x => x.metadata.name === 'allow-egress-oracle')!;
    const egress = (p.spec.egress as { to: { ipBlock: { cidr: string } }[]; ports: { port: number }[] }[])[0]!;
    expect(egress.to[0]!.ipBlock.cidr).toBe('192.168.10.0/24');
    expect(egress.ports[0]!.port).toBe(1521);
  });

  it('refuses to invent a rule for an Azure PaaS endpoint, and says why', () => {
    // NetworkPolicy matches on IP and has no service-tag equivalent. A plausible
    // ipBlock here would break the first time Azure reassigns an address, which is
    // worse than no rule at all.
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [
        { name: 'sql', direction: 'egress', target: { kind: 'azure-service', service: 'Sql' } },
      ],
    });
    expect(names(plan.policies)).not.toContain('allow-egress-sql');
    expect(plan.caveats.join(' ')).toContain('service tags');
    expect(plan.caveats.join(' ')).toContain('Private Endpoint');
  });

  it('warns when on-premises is requested without CIDRs', () => {
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [{ name: 'db', direction: 'egress', target: { kind: 'on-premises', cidrs: [] } }],
    });
    expect(plan.caveats.join(' ')).toContain('no CIDRs were given');
  });

  it('produces names the API server will actually accept', () => {
    // The old assertion was /^[a-z0-9-]+$/, which a trailing hyphen satisfies -
    // so it could not catch `allow-egress-payments-api-prod-`, which oc rejects.
    const RFC1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
    for (const n of ['Payments API (prod)', '...', 'a'.repeat(80), 'DB---']) {
      const plan = planNetworkPolicies({
        namespace: NS,
        endpoints: [{ name: n, direction: 'egress', target: { kind: 'internet' } }],
      });
      for (const name of names(plan.policies)) {
        expect(name).toMatch(RFC1123);
        expect(name.length).toBeLessThanOrEqual(63);
      }
    }
  });
});

describe('cluster settings derived from the same answers', () => {
  const ingressInternet: EndpointRequest = { name: 'web', direction: 'ingress', target: { kind: 'internet' } };
  const egressInternet: EndpointRequest = { name: 'api', direction: 'egress', target: { kind: 'internet' } };

  it('keeps the API server private by default', () => {
    expect(clusterSettingsFor([ingressInternet]).apiVisibility).toBe('Private');
  });

  it('only exposes ingress publicly when public ingress was asked for', () => {
    expect(clusterSettingsFor([ingressInternet]).ingressVisibility).toBe('Public');
    expect(clusterSettingsFor([egressInternet]).ingressVisibility).toBe('Private');
  });

  it('uses UserDefinedRouting when nothing needs internet egress', () => {
    expect(clusterSettingsFor([ingressInternet]).outboundType).toBe('UserDefinedRouting');
    expect(clusterSettingsFor([egressInternet]).outboundType).toBe('LoadBalancer');
  });
});

describe('completeness', () => {
  it('raises no caveats for an empty form', () => {
    // An untouched form should look calm, not warn about things not yet done.
    expect(planNetworkPolicies({ namespace: NS, endpoints: [] }).caveats).toEqual([]);
  });

  it('still raises caveats it genuinely cannot express', () => {
    const plan = planNetworkPolicies({
      namespace: NS,
      endpoints: [{ name: 'sql', direction: 'egress', target: { kind: 'azure-service', service: 'Sql' } }],
    });
    expect(plan.caveats).toHaveLength(1);
  });
});
