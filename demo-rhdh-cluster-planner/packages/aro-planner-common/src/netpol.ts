import type { AroFlavour } from './types.js';

/**
 * Turn a team's stated connectivity into NetworkPolicies.
 *
 * The output is deliberately conservative: a default-deny baseline plus the minimum
 * needed to keep a normal OpenShift workload functioning, then one rule per endpoint
 * the team actually asked for.
 *
 * Where NetworkPolicy genuinely cannot express an intent - Azure PaaS endpoints
 * being the common case - this emits a caveat instead of a rule. A policy that looks
 * right and silently does not match is worse than no policy.
 */

export type EndpointDirection = 'ingress' | 'egress';

export type EndpointTarget =
  /** The public internet. */
  | { kind: 'internet' }
  /** Another namespace on the same cluster. */
  | { kind: 'namespace'; namespace: string }
  /** On-premises networks, by CIDR. */
  | { kind: 'on-premises'; cidrs: string[] }
  /** An Azure PaaS service - SQL, Storage, Key Vault and so on. */
  | { kind: 'azure-service'; service: string };

export interface PortSpec {
  protocol: 'TCP' | 'UDP';
  port: number;
}

export interface EndpointRequest {
  /** Short name, used in the generated policy name. */
  name: string;
  direction: EndpointDirection;
  target: EndpointTarget;
  ports?: PortSpec[];
}

export interface NetworkRequest {
  namespace: string;
  endpoints: EndpointRequest[];
  flavour?: AroFlavour;
}

/** A NetworkPolicy as a plain object, ready to serialise to YAML. */
export interface NetworkPolicyManifest {
  apiVersion: 'networking.k8s.io/v1';
  kind: 'NetworkPolicy';
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  spec: Record<string, unknown>;
}

/** Cluster-level networking, which the same answers also determine. */
export interface ClusterNetworkSettings {
  apiVisibility: 'Public' | 'Private';
  ingressVisibility: 'Public' | 'Private';
  outboundType: 'LoadBalancer' | 'UserDefinedRouting';
}

export interface NetworkPlan {
  namespace: string;
  policies: NetworkPolicyManifest[];
  /** Things NetworkPolicy cannot express. Must be surfaced, not swallowed. */
  caveats: string[];
  clusterSettings: ClusterNetworkSettings;
}

const RFC1123 = /[^a-z0-9-]/g;

/**
 * Turn a free-text endpoint name into an RFC 1123 label.
 *
 * The trailing-hyphen trim matters: "Payments API (prod)" would otherwise become
 * `allow-egress-payments-api-prod-`, which the API server rejects outright. A
 * name must start and end alphanumeric.
 */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(RFC1123, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'endpoint';

function policy(
  name: string,
  namespace: string,
  spec: Record<string, unknown>,
  annotations?: Record<string, string>,
): NetworkPolicyManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name, namespace, ...(annotations ? { annotations } : {}) },
    spec,
  };
}

function ports(p?: PortSpec[]) {
  return p && p.length > 0 ? { ports: p.map(x => ({ protocol: x.protocol, port: x.port })) } : {};
}

/**
 * The baseline every namespace gets.
 *
 * Deny everything, then re-open only what breaks OpenShift itself if left closed.
 * Omitting the DNS rule is the classic mistake - every pod in the namespace fails
 * name resolution and the cause is not obvious from the application logs.
 */
export function baselinePolicies(namespace: string): NetworkPolicyManifest[] {
  return [
    policy('default-deny-all', namespace, {
      podSelector: {},
      policyTypes: ['Ingress', 'Egress'],
    }),
    policy('allow-same-namespace', namespace, {
      podSelector: {},
      // Both directions. With Ingress alone the receiving pod accepts the
      // connection but the sending pod's egress is still denied by
      // default-deny-all, so pod-to-pod traffic inside the namespace fails -
      // which is the first thing anyone tries after applying these.
      policyTypes: ['Ingress', 'Egress'],
      ingress: [{ from: [{ podSelector: {} }] }],
      egress: [{ to: [{ podSelector: {} }] }],
    }),
    policy('allow-dns-egress', namespace, {
      podSelector: {},
      policyTypes: ['Egress'],
      egress: [
        {
          to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'openshift-dns' } } }],
          ports: [
            { protocol: 'UDP', port: 5353 },
            { protocol: 'TCP', port: 5353 },
            { protocol: 'UDP', port: 53 },
            { protocol: 'TCP', port: 53 },
          ],
        },
      ],
    }),
    policy('allow-from-openshift-monitoring', namespace, {
      podSelector: {},
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'openshift-monitoring' } } },
          ],
        },
      ],
    }),
  ];
}

function endpointPolicy(
  ep: EndpointRequest,
  namespace: string,
): { policy?: NetworkPolicyManifest; caveat?: string } {
  const name = `allow-${ep.direction}-${slug(ep.name)}`;
  const t = ep.target;

  switch (t.kind) {
    case 'internet': {
      if (ep.direction === 'ingress') {
        // Public traffic arrives through the router, never directly from the internet.
        return {
          policy: policy(name, namespace, {
            podSelector: {},
            policyTypes: ['Ingress'],
            ingress: [
              {
                from: [
                  {
                    namespaceSelector: {
                      matchLabels: { 'policy-group.network.openshift.io/ingress': '' },
                    },
                  },
                ],
                ...ports(ep.ports),
              },
            ],
          }),
        };
      }
      // Egress to anywhere, minus the cluster's own networks.
      return {
        policy: policy(
          name,
          namespace,
          {
            podSelector: {},
            policyTypes: ['Egress'],
            egress: [
              {
                to: [
                  {
                    ipBlock: {
                      cidr: '0.0.0.0/0',
                      except: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
                    },
                  },
                ],
                ...ports(ep.ports),
              },
            ],
          },
          {
            'aro-planner/note':
              'Excludes RFC1918 ranges so this rule cannot be used to reach private networks.',
          },
        ),
      };
    }

    case 'namespace': {
      const peer = {
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': t.namespace } },
      };
      return {
        policy: policy(name, namespace, {
          podSelector: {},
          policyTypes: [ep.direction === 'ingress' ? 'Ingress' : 'Egress'],
          ...(ep.direction === 'ingress'
            ? { ingress: [{ from: [peer], ...ports(ep.ports) }] }
            : { egress: [{ to: [peer], ...ports(ep.ports) }] }),
        }),
      };
    }

    case 'on-premises': {
      if (t.cidrs.length === 0) {
        return { caveat: `Endpoint "${ep.name}" is on-premises but no CIDRs were given, so no rule was generated.` };
      }
      const peers = t.cidrs.map(cidr => ({ ipBlock: { cidr } }));
      return {
        policy: policy(name, namespace, {
          podSelector: {},
          policyTypes: [ep.direction === 'ingress' ? 'Ingress' : 'Egress'],
          ...(ep.direction === 'ingress'
            ? { ingress: [{ from: peers, ...ports(ep.ports) }] }
            : { egress: [{ to: peers, ...ports(ep.ports) }] }),
        }),
      };
    }

    case 'azure-service': {
      // NetworkPolicy matches on IP, and Azure PaaS endpoints sit behind large,
      // changing public ranges. A service tag has no NetworkPolicy equivalent, so
      // emitting an ipBlock here would produce a rule that breaks the first time
      // Azure reassigns an address.
      return {
        caveat:
          `Endpoint "${ep.name}" targets the Azure service "${t.service}". NetworkPolicy ` +
          `selects on IP and has no concept of Azure service tags, so no rule was generated. ` +
          `Use a Private Endpoint and allow its address, or an egress IP plus an Azure ` +
          `firewall rule. AdminNetworkPolicy can express this at cluster scope if the ` +
          `cluster has it enabled.`,
      };
    }

    default: {
      const exhaustive: never = t;
      return { caveat: `Unsupported endpoint target: ${JSON.stringify(exhaustive)}` };
    }
  }
}

/**
 * Cluster-level networking implied by the endpoints.
 *
 * A namespace that never accepts internet ingress does not need a public ingress
 * controller, and a cluster with no internet egress at all wants
 * UserDefinedRouting rather than a load balancer.
 */
export function clusterSettingsFor(endpoints: EndpointRequest[]): ClusterNetworkSettings {
  const publicIngress = endpoints.some(
    e => e.direction === 'ingress' && e.target.kind === 'internet',
  );
  const internetEgress = endpoints.some(
    e => e.direction === 'egress' && e.target.kind === 'internet',
  );

  return {
    // The API server stays private unless someone has a reason to expose it;
    // exposing it is a decision, not a default.
    apiVisibility: 'Private',
    ingressVisibility: publicIngress ? 'Public' : 'Private',
    outboundType: internetEgress ? 'LoadBalancer' : 'UserDefinedRouting',
  };
}

export function planNetworkPolicies(req: NetworkRequest): NetworkPlan {
  const { namespace, endpoints } = req;
  const policies = baselinePolicies(namespace);
  const caveats: string[] = [];

  for (const ep of endpoints) {
    const { policy: p, caveat } = endpointPolicy(ep, namespace);
    if (p) policies.push(p);
    if (caveat) caveats.push(caveat);
  }

  return {
    namespace,
    policies,
    caveats,
    clusterSettings: clusterSettingsFor(endpoints),
  };
}
