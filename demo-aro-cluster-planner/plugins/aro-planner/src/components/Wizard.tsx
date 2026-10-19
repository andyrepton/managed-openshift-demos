import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

import { planStorage } from '@aro-planner/common';

import {
  fetchPlan,
  type EndpointInput,
  type OperatorId,
  type PlanInput,
  type PlanResponse,
} from '../api/client';
import { AssistantPanel } from './AssistantPanel';
import { CostPanel } from './CostPanel';
import { NetworkSection } from './NetworkSection';
import { OperatorSection } from './OperatorSection';
import { RequestDialog } from './RequestDialog';

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

const STORAGE_TIERS = [
  { id: 'premium-ssd', label: 'Premium SSD - the ARO default' },
  { id: 'standard-ssd', label: 'Standard SSD - cheaper, slower' },
] as const;

const INITIAL: PlanInput = {
  applicationName: '',
  vcpu: 40,
  ramGiB: 160,
  storageGiB: 0,
  storageTier: 'premium-ssd',
  region: 'westeurope',
  flavour: 'hcp',
  highAvailability: true,
  dayTwo: false,
  // The cheapest option a team is likely to need, and the one that should have
  // to be argued out of rather than into. Note the first price the panel shows
  // is therefore a DEMO_MULTIPLIERS figure, not an Azure meter - it is marked
  // "~" and carries the warning, which is the point.
  deploymentModel: 'shared-namespace',
  operators: [],
  endpoints: [],
};

const MODELS = [
  { id: 'shared-namespace', label: 'Namespace on a shared cluster' },
  { id: 'dedicated-cluster', label: 'Dedicated cluster' },
  { id: 'on-premises', label: 'I require an on-premise setup' },
] as const;

/** Lower-case DNS label - this becomes the namespace name. */
const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export interface WizardProps {
  onPlanChange?: (plan: PlanResponse | null) => void;
  initial?: Partial<PlanInput>;
}

export function Wizard({ onPlanChange, initial }: WizardProps) {
  const [form, setForm] = useState<PlanInput>({ ...INITIAL, ...initial });
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [requestOpen, setRequestOpen] = useState(false);

  const set = <K extends keyof PlanInput>(key: K, value: PlanInput[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  /**
   * Apply a change the assistant made.
   *
   * Functional update, because a single turn can return several patches and they
   * are applied in a loop - reading `form` from the closure would make each one
   * overwrite the last.
   */
  const applyPatch = useCallback(
    (patch: Partial<PlanInput>) => setForm(f => ({ ...f, ...patch })),
    [],
  );

  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const key = JSON.stringify(form);
  const abortRef = useRef<AbortController | null>(null);
  const notify = useRef(onPlanChange);
  notify.current = onPlanChange;

  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);

      discoveryApi
        .getBaseUrl('aro-planner')
        .then(baseUrl => fetchPlan(baseUrl, fetchApi.fetch, form, ac.signal))
        .then(res => {
          setPlan(res);
          setError(undefined);
          notify.current?.(res);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : String(err));
          setPlan(null);
          notify.current?.(null);
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onPrem = form.deploymentModel === 'on-premises';

  // Follow the chosen model. Previously this read plan.estimate, which is always
  // the dedicated-cluster costing, so selecting "namespace" left the panel stale.
  const chosen = plan?.comparison.find(c => c.model === form.deploymentModel) ?? null;
  const chosenEstimate = chosen?.estimate ?? null;

  // The backend only costs the models relevant to the current selection, so a
  // price is shown where we have one and the label stays bare otherwise rather
  // than rendering a stale or invented figure.
  // Every model is costed, but only the dedicated cluster comes from a real meter.
  // A derived figure is prefixed "~", coloured as a warning, and called out below
  // the group, so it never carries the same visual weight as the Azure price.
  const priceFor = (model: string): { text: string; assumed: boolean } => {
    const m = plan?.comparison.find(c => c.model === model);
    if (!m || m.amount === null) return { text: ' ', assumed: false };
    const assumed = !(m.estimate?.lines ?? []).some(l => l.source === 'azure-api');
    const amount = m.amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return { text: `${assumed ? '~' : ''}$${amount}/mo`, assumed };
  };

  const anyAssumed = (plan?.comparison ?? []).some(
    c => !(c.estimate?.lines ?? []).some(l => l.source === 'azure-api'),
  );
  const recs = plan?.recommendations ?? [];
  const cheapest = recs[0]?.hourlyVmCost;

  // Comes from the estimate rather than a literal 730, so a configured
  // hoursPerMonth moves the per-option delta with everything else.
  const hoursPerMonth = plan?.estimate?.hoursPerMonth ?? 730;

  // Mirrors the engine's tier rounding so the hint matches the costed figure.
  const storagePlan = useMemo(
    () =>
      form.storageGiB && form.storageGiB > 0
        ? planStorage(form.storageGiB, form.storageTier ?? 'premium-ssd')
        : null,
    [form.storageGiB, form.storageTier],
  );

  const ratio = useMemo(
    () => (form.vcpu > 0 ? (form.ramGiB / form.vcpu).toFixed(1) : '--'),
    [form.vcpu, form.ramGiB],
  );

  const name = form.applicationName ?? '';
  const nameValid = NAME_RE.test(name);
  const canRequest = nameValid && !loading && !error && plan !== null;

  return (
    <>
      <Grid container spacing={2}>
        <Grid item xs={12} md={7} lg={8}>
          <Stack spacing={2}>
            {/* Above the form, not beside it: the assistant writes to these
                fields, so it reads as the thing driving them. */}
            <AssistantPanel state={form} onApply={applyPatch} />

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Your application</Typography>
              <TextField
                label="Application name"
                fullWidth
                size="small"
                required
                value={name}
                onChange={e => set('applicationName', e.target.value)}
                error={name.length > 0 && !nameValid}
                helperText={
                  name.length > 0 && !nameValid
                    ? 'Lower-case letters, numbers and hyphens only - this becomes the namespace name'
                    : 'Used to name the namespace and the generated artifacts, e.g. payments-api'
                }
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>What option fits best for you?</Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={form.deploymentModel}
                onChange={(_e, v) => v && set('deploymentModel', v)}
                aria-label="Deployment model"
                sx={{ alignItems: 'stretch' }}
              >
                {MODELS.map(m => {
                  const price = priceFor(m.id);
                  return (
                    <ToggleButton key={m.id} value={m.id} sx={{ flexDirection: 'column', py: 1 }}>
                      <Typography variant="body2" sx={{ textTransform: 'none', fontWeight: 600 }}>
                        {m.label}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ textTransform: 'none' }}
                        color={price.assumed ? 'warning.main' : 'success.main'}
                      >
                        {price.text}
                      </Typography>
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>

              {anyAssumed && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  <Typography variant="caption">
                    Only the dedicated cluster is priced from the Azure Retail Prices
                    API. Figures marked <strong>~</strong> are assumptions made for this
                    demo &mdash; a namespace at 50% of the dedicated per-vCPU rate and
                    on-premises at 5x. They are not measured, not benchmarked and not
                    Red Hat guidance.
                  </Typography>
                </Alert>
              )}

              {onPrem && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Azure instance sizing does not apply on-premises. The monthly figure
                  is an amortised estimate for the vCPU you ask for, not a bill &mdash;
                  most on-premises cost is fixed and committed up front.
                </Alert>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Capacity</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                These are <strong>allocatable</strong> figures, what your pods can actually
                request. Per-node OpenShift overhead is added on top for you.
              </Typography>

              <Grid container spacing={2} alignItems="center">
                <Grid item xs={6} sm={4}>
                  <TextField
                    label="vCPU" type="number" fullWidth size="small"
                    inputProps={{ min: 1 }}
                    value={form.vcpu}
                    onChange={e => set('vcpu', Number(e.target.value))}
                  />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <TextField
                    label="Memory (GiB)" type="number" fullWidth size="small"
                    inputProps={{ min: 1 }}
                    value={form.ramGiB}
                    onChange={e => set('ramGiB', Number(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box textAlign="center">
                    <Typography variant="h5" fontWeight={700}>{ratio}</Typography>
                    <Typography variant="caption" color="text.secondary">GiB per vCPU</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    select label="Workload type" fullWidth size="small"
                    SelectProps={{ native: true }}
                    InputLabelProps={{ shrink: true }}
                    value={form.profile ?? ''}
                    onChange={e => set('profile', e.target.value || undefined)}
                  >
                    {PROFILES.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={6} sm={4}>
                  <TextField
                    label="Persistent storage (GiB)" type="number" fullWidth size="small"
                    inputProps={{ min: 0, max: 32767 }}
                    value={form.storageGiB ?? 0}
                    onChange={e => set('storageGiB', Math.max(0, Number(e.target.value)))}
                    helperText={onPrem ? 'Still sized, not costed' : '0 for none'}
                  />
                </Grid>

                {/* Azure disk tiers are meaningless on-premises - there are no
                    managed disks to choose between. The capacity is still worth
                    capturing, because whoever owns the on-prem platform needs
                    the number; it just is not something this tool can price. */}
                {!onPrem && (
                  <Grid item xs={6} sm={8}>
                    <TextField
                      select label="Disk tier" fullWidth size="small"
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      disabled={!(form.storageGiB && form.storageGiB > 0)}
                      value={form.storageTier ?? 'premium-ssd'}
                      onChange={e => set('storageTier', e.target.value as PlanInput['storageTier'])}
                    >
                      {STORAGE_TIERS.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </TextField>
                  </Grid>
                )}

                {onPrem && (form.storageGiB ?? 0) > 0 && (
                  <Grid item xs={12} sm={8}>
                    <Alert severity="info">
                      <Typography variant="caption">
                        On-premises storage is <strong>costed separately</strong> and is not
                        included in the figure on the right. Arrays, shelves and the
                        software to run them are bought up front, on their own cycle, and
                        nothing about Azure managed disks applies. The capacity is recorded
                        so whoever owns the platform has the number.
                      </Typography>
                    </Alert>
                  </Grid>
                )}

                {/* Capacity is bought in whole tiers, the same as nodes, so the
                    gap between what you ask for and what you pay for is worth
                    showing at the point of asking. */}
                {!onPrem && storagePlan && storagePlan.wastedGiB > 0 && (
                  <Grid item xs={12}>
                    <Alert severity="info">
                      <Typography variant="caption">
                        Azure bills a managed disk at its provisioned tier, so{' '}
                        {form.storageGiB} GiB is charged as a{' '}
                        <strong>{storagePlan.disk.name}</strong> at {storagePlan.disk.gib} GiB
                        &mdash; {storagePlan.wastedGiB} GiB paid for and unusable. Asking for{' '}
                        {storagePlan.disk.gib} GiB costs the same.
                      </Typography>
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </Paper>

            {/* Azure specifics are meaningless for an on-premises request. */}
            {!onPrem && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Cluster</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select label="Architecture" fullWidth size="small"
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      value={form.flavour}
                      onChange={e => set('flavour', e.target.value as PlanInput['flavour'])}
                    >
                      <option value="hcp">ARO with hosted control planes</option>
                      <option value="classic">ARO standard architecture</option>
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select label="Azure region" fullWidth size="small"
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      value={form.region}
                      onChange={e => set('region', e.target.value)}
                    >
                      {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </TextField>
                  </Grid>
                </Grid>

                {form.flavour === 'hcp' && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    Microsoft has not published the per-cluster control-plane fee for
                    hosted control planes. The figure used here is an assumption.
                  </Alert>
                )}

                <FormControlLabel
                  sx={{ mt: 1, display: 'flex' }}
                  control={
                    <Checkbox
                      checked={form.highAvailability}
                      onChange={e => set('highAvailability', e.target.checked)}
                    />
                  }
                  label="Spread evenly across three availability zones"
                />
              </Paper>
            )}

            <OperatorSection
              selected={form.operators ?? []}
              onChange={(ids: OperatorId[]) => set('operators', ids)}
            />

            <NetworkSection
              endpoints={form.endpoints ?? []}
              onChange={(eps: EndpointInput[]) => set('endpoints', eps)}
              networkPlan={plan?.networkPlan ?? null}
            />

            {!onPrem && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Node pool options</Typography>
                {recs.length === 0 && !loading && (
                  <Typography variant="body2" color="text.secondary">No options yet.</Typography>
                )}
                <Stack spacing={1}>
                  {recs.map((r, i) => {
                    const delta =
                      r.hourlyVmCost !== undefined && cheapest !== undefined
                        ? (r.hourlyVmCost - cheapest) * hoursPerMonth
                        : 0;
                    // The server's answer wins. A selection can stop being
                    // offered when the capacity changes, and the backend then
                    // falls back to the cheapest - the highlight has to follow
                    // what was actually costed, not what was last clicked.
                    const selected = (plan?.selectedSku ?? form.nodePoolSku) === r.sku.name;
                    return (
                      <Card
                        key={r.sku.name}
                        variant="outlined"
                        sx={{
                          borderColor: selected ? 'primary.main' : undefined,
                          borderWidth: selected ? 2 : 1,
                        }}
                      >
                        {/* Selecting one re-prices the cluster and changes what
                            gets emitted. These were read-only until the costing
                            could actually follow the choice. */}
                        <CardActionArea onClick={() => set('nodePoolSku', r.sku.name)}>
                          <CardContent sx={{ py: 1.5 }}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <Typography fontWeight={700}>
                                {r.nodes} &times; {r.sku.name}
                              </Typography>
                              {selected && <Chip size="small" color="primary" label="selected" />}
                              {i === 0 && (
                                <Chip size="small" variant="outlined" color="success" label="cheapest" />
                              )}
                              {delta > 0 && (
                                <Chip size="small" variant="outlined" label={`+$${delta.toFixed(0)}/mo`} />
                              )}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block">
                              {r.totalVcpu} vCPU / {r.totalRamGiB} GiB raw &middot;{' '}
                              {Math.round(r.waste * 100)}% spare after OpenShift overhead
                            </Typography>
                          </CardContent>
                        </CardActionArea>
                      </Card>
                    );
                  })}
                </Stack>
              </Paper>
            )}

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Button
                  variant="contained"
                  size="large"
                  disabled={!canRequest}
                  onClick={() => setRequestOpen(true)}
                >
                  Request this setup
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {nameValid
                    ? 'Review the request before it goes to the platform team.'
                    : 'Give your application a name to continue.'}
                </Typography>
              </Stack>
            </Paper>
          </Stack>
        </Grid>

        {/* Stays put while the form scrolls, so a change and its effect on the
            price are visible at the same time - which is the entire argument
            for having the panel. alignSelf stops the grid item stretching to
            the row height, which would make sticky a no-op. */}
        <Grid
          item
          xs={12}
          md={5}
          lg={4}
          sx={{
            alignSelf: 'flex-start',
            position: { md: 'sticky' },
            top: { md: 16 },
            maxHeight: { md: 'calc(100vh - 32px)' },
            overflowY: { md: 'auto' },
          }}
        >
          <CostPanel
            estimate={chosenEstimate}
            loading={loading}
            error={error}
            warning={plan?.warning}
            stale={plan?.pricesStale ?? false}
            retrievedAt={plan?.pricesRetrievedAt}
          />
        </Grid>
      </Grid>

      <RequestDialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        form={form}
        plan={plan}
      />
    </>
  );
}
