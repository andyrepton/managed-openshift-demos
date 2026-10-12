import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchPlan, type PlanInput, type PlanResponse } from '../api.js';
import { CostPanel } from './CostPanel.js';

/**
 * Regions ARO is commonly deployed to. The backend validates whatever is sent, so
 * this list is a convenience rather than a constraint.
 */
const REGIONS = [
  'westeurope', 'northeurope', 'uksouth', 'ukwest',
  'eastus', 'eastus2', 'westus2', 'westus3', 'centralus',
  'australiaeast', 'southeastasia', 'japaneast',
];

const PROFILES = [
  { id: '', label: 'Infer from my vCPU : RAM ratio' },
  { id: 'general', label: 'General purpose - web apps, APIs' },
  { id: 'memory-heavy', label: 'Memory heavy - caches, in-memory data' },
  { id: 'compute-heavy', label: 'Compute heavy - batch, encoding' },
  { id: 'storage-heavy', label: 'Storage heavy - databases, local NVMe' },
  { id: 'gpu', label: 'GPU - model serving, training' },
];

const DEBOUNCE_MS = 400;

const initial: PlanInput = {
  vcpu: 40,
  ramGiB: 160,
  region: 'westeurope',
  flavour: 'hcp',
  highAvailability: true,
  dayTwo: false,
};

export function Wizard() {
  const [form, setForm] = useState<PlanInput>(initial);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selected, setSelected] = useState(0);

  const set = <K extends keyof PlanInput>(key: K, value: PlanInput[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  // Re-price on every change, debounced. The whole point of the panel is that the
  // number moves while you are still deciding, not after you submit.
  const key = JSON.stringify(form);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      fetchPlan(form, ac.signal)
        .then(res => {
          setPlan(res);
          setSelected(0);
          setError(undefined);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : String(err));
          setPlan(null);
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const recs = plan?.recommendations ?? [];
  const cheapest = recs[0]?.hourlyVmCost;

  const ratio = useMemo(
    () => (form.vcpu > 0 ? (form.ramGiB / form.vcpu).toFixed(1) : '--'),
    [form.vcpu, form.ramGiB],
  );

  return (
    <div className="layout">
      <main className="form">
        <h1>Plan an ARO cluster</h1>
        <p className="muted">
          Describe what your team needs. Sizing, instance types and cost update as you type.
        </p>

        <section>
          <h2>Capacity</h2>
          <p className="hint">
            These are <strong>allocatable</strong> figures - what your pods can actually request.
            Per-node OpenShift overhead is added on top for you.
          </p>

          <div className="row">
            <label>
              vCPU
              <input
                type="number"
                min={1}
                value={form.vcpu}
                onChange={e => set('vcpu', Number(e.target.value))}
              />
            </label>
            <label>
              Memory (GiB)
              <input
                type="number"
                min={1}
                value={form.ramGiB}
                onChange={e => set('ramGiB', Number(e.target.value))}
              />
            </label>
            <div className="ratio">
              <span className="ratio-value">{ratio}</span>
              <span className="ratio-label">GiB per vCPU</span>
            </div>
          </div>

          <label>
            Workload type
            <select value={form.profile ?? ''} onChange={e => set('profile', e.target.value || undefined)}>
              {PROFILES.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h2>Cluster</h2>
          <div className="row">
            <label>
              Architecture
              <select
                value={form.flavour}
                onChange={e => set('flavour', e.target.value as PlanInput['flavour'])}
              >
                <option value="hcp">ARO with hosted control planes</option>
                <option value="classic">ARO standard architecture</option>
              </select>
            </label>
            <label>
              Azure region
              <select value={form.region} onChange={e => set('region', e.target.value)}>
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>

          {form.flavour === 'hcp' && (
            <p className="hint hint-warn">
              Microsoft has not published the per-cluster control-plane fee for hosted control
              planes, so it is excluded from the total below.
            </p>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={form.highAvailability}
              onChange={e => set('highAvailability', e.target.checked)}
            />
            Spread evenly across three availability zones
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={form.dayTwo}
              onChange={e => set('dayTwo', e.target.checked)}
            />
            Adding a pool to an existing cluster
            <span className="hint-inline">unlocks sizes ARO only supports as a day-2 addition</span>
          </label>
        </section>

        <section>
          <h2>Node pool options</h2>
          {recs.length === 0 && !loading && <p className="muted">No options yet.</p>}

          <div className="options">
            {recs.map((r, i) => {
              const delta =
                r.hourlyVmCost !== undefined && cheapest !== undefined
                  ? (r.hourlyVmCost - cheapest) * 730
                  : 0;
              return (
                <button
                  type="button"
                  key={r.sku.name}
                  className={`option ${i === selected ? 'option-selected' : ''}`}
                  onClick={() => setSelected(i)}
                  aria-pressed={i === selected}
                >
                  <div className="option-head">
                    <span className="option-title">{r.nodes} &times; {r.sku.name}</span>
                    {i === 0 && <span className="tag tag-best">cheapest</span>}
                    {r.sku.day2Only && <span className="tag tag-assumption">day-2 only</span>}
                  </div>
                  <div className="option-spec">
                    {r.totalVcpu} vCPU / {r.totalRamGiB} GiB &middot; {Math.round(r.waste * 100)}% spare
                    {delta > 0 && <span className="option-delta">+${delta.toFixed(0)}/mo</span>}
                  </div>
                  <ul className="option-why">
                    {r.rationale.slice(1).map(line => <li key={line}>{line}</li>)}
                  </ul>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      <CostPanel
        estimate={plan?.estimate ?? null}
        loading={loading}
        error={error}
        warning={plan?.warning}
        stale={plan?.pricesStale ?? false}
        retrievedAt={plan?.pricesRetrievedAt}
      />
    </div>
  );
}
