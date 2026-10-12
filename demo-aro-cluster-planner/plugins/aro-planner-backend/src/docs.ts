/**
 * Curated ARO documentation links.
 *
 * A fixed list rather than a search index, for two reasons. The assistant's own RAG
 * corpus is Red Hat product documentation, so Microsoft Learn content is never in
 * it; and a model asked about ARO specifics will otherwise answer from memory and
 * invent plausible URLs. Giving it a short list of real ones to cite is the whole
 * point of the tool.
 *
 * Keep entries few and specific. A long list of near-duplicates makes the model
 * pick badly.
 */
export interface DocEntry {
  topic: string;
  title: string;
  url: string;
  source: 'Microsoft Learn' | 'Red Hat';
  summary: string;
  keywords: string[];
}

export const ARO_DOCS: DocEntry[] = [
  {
    topic: 'supported-vm-sizes',
    title: 'ARO support policy: supported virtual machine sizes',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4',
    source: 'Microsoft Learn',
    summary:
      'The authoritative list of VM sizes ARO supports, by role and category, with ' +
      'vCPU, RAM and which sizes are day-2-only. Also states the three-worker minimum ' +
      'and the 250-worker maximum.',
    keywords: ['vm size', 'instance type', 'sku', 'supported', 'support policy', 'worker', 'control plane', 'minimum', 'maximum'],
  },
  {
    topic: 'pricing',
    title: 'Azure Red Hat OpenShift pricing',
    url: 'https://azure.microsoft.com/en-us/pricing/details/openshift/',
    source: 'Microsoft Learn',
    summary:
      'Billing model: Azure infrastructure for the VMs, plus a flat OpenShift licence ' +
      'fee on worker cores. Control plane nodes are not licensed. Note the ARO HCP ' +
      'per-cluster control-plane fee is NOT published here.',
    keywords: ['price', 'pricing', 'cost', 'billing', 'licence', 'license', 'fee'],
  },
  {
    topic: 'hosted-control-planes',
    title: 'ARO with hosted control planes',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/hosted-control-planes/concepts-hosted-control-planes',
    source: 'Microsoft Learn',
    summary:
      'The HCP deployment option, where Microsoft hosts the control plane in a ' +
      'managed subscription. Differs from standard architecture in billing and in ' +
      'what the customer can configure.',
    keywords: ['hcp', 'hosted control plane', 'hosted', 'control plane'],
  },
  {
    topic: 'networking',
    title: 'ARO networking concepts',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/concepts-networking',
    source: 'Microsoft Learn',
    summary:
      'VNet and subnet requirements, pod and service CIDRs, ingress and API server ' +
      'visibility, and outbound types (LoadBalancer vs UserDefinedRouting).',
    keywords: ['network', 'networking', 'vnet', 'subnet', 'cidr', 'ingress', 'egress', 'outbound', 'private'],
  },
  {
    topic: 'network-policy',
    title: 'About network policy (OpenShift)',
    url: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.19/html/networking/network-policy',
    source: 'Red Hat',
    summary:
      'How NetworkPolicy works on OpenShift, including selecting the ingress ' +
      'controller namespace and the DNS egress rule every namespace needs. ' +
      'NetworkPolicy matches on IP and has no equivalent of Azure service tags.',
    keywords: ['network policy', 'networkpolicy', 'firewall', 'isolation', 'deny', 'allow'],
  },
  {
    topic: 'private-cluster',
    title: 'Create a private ARO cluster',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/howto-create-private-cluster-4x',
    source: 'Microsoft Learn',
    summary: 'Private API server and private ingress, and what that implies for access and egress.',
    keywords: ['private', 'private cluster', 'api visibility', 'public'],
  },
  {
    topic: 'machine-pools',
    title: 'Create and manage ARO worker nodes / machine pools',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/howto-machine-pools',
    source: 'Microsoft Learn',
    summary: 'Adding, scaling and removing worker node pools after cluster creation.',
    keywords: ['machine pool', 'node pool', 'machineset', 'scale', 'autoscale', 'worker'],
  },
  {
    topic: 'upgrades',
    title: 'Upgrade an ARO cluster',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/howto-upgrade',
    source: 'Microsoft Learn',
    summary: 'Upgrade channels, the supported version window, and the upgrade process.',
    keywords: ['upgrade', 'update', 'version', 'lifecycle', 'eol'],
  },
  {
    topic: 'responsibilities',
    title: 'ARO responsibility matrix',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/responsibility-matrix',
    source: 'Microsoft Learn',
    summary:
      'Who is responsible for what between the customer, Microsoft and Red Hat. The ' +
      'first thing to check when deciding whether a managed service fits.',
    keywords: ['responsibility', 'sla', 'managed', 'support', 'shared responsibility', 'who manages'],
  },
  {
    topic: 'quotas',
    title: 'Required Azure resource quotas for ARO',
    url: 'https://learn.microsoft.com/en-us/azure/openshift/quickstart-portal#before-you-begin',
    source: 'Microsoft Learn',
    summary: 'vCPU quota needed before a cluster will create. A common cause of failed provisioning.',
    keywords: ['quota', 'limit', 'vcpu quota', 'capacity', 'provisioning failed'],
  },
];

/** Rank entries against a free-text topic. Keyword hits score above title hits. */
export function lookupDocs(topic: string, limit = 3): DocEntry[] {
  const q = topic.toLowerCase().trim();
  if (!q) return [];
  const words = q.split(/\s+/).filter(w => w.length > 2);

  const scored = ARO_DOCS.map(d => {
    let score = 0;
    for (const k of d.keywords) {
      if (q.includes(k)) score += 10;
      else if (words.some(w => k.includes(w))) score += 4;
    }
    if (d.topic.includes(q.replace(/\s+/g, '-'))) score += 8;
    for (const w of words) {
      if (d.title.toLowerCase().includes(w)) score += 2;
      if (d.summary.toLowerCase().includes(w)) score += 1;
    }
    return { d, score };
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(x => x.d);
}
