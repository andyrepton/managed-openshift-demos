import React, { useCallback, useEffect, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

import {
  fetchCapabilities,
  fetchPlan,
  provision,
  type Capabilities,
  type DevSpaceRequestInput,
  type PlanResponse,
  type ProvisionResult,
} from '../api/client';
import { PlanPanel } from './PlanPanel';

const DEBOUNCE_MS = 400;

const INITIAL: DevSpaceRequestInput = {
  workspaceCount: 1,
  totalVcpu: 2,
  totalRamGiB: 4,
  storageGiB: 10,
  storageMode: 'persistent',
  agents: [],
  ai: { kind: 'none' },
};

export function RequestForm() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | undefined>();
  const [form, setForm] = useState<DevSpaceRequestInput>(INITIAL);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const set = <K extends keyof DevSpaceRequestInput>(k: K, v: DevSpaceRequestInput[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const ac = new AbortController();
    discoveryApi
      .getBaseUrl('devspaces-self-service')
      .then(base => fetchCapabilities(base, fetchApi.fetch, ac.signal))
      .then(setCaps)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setCapsError(err instanceof Error ? err.message : String(err));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-plan as the form changes. The preview is free - it touches no cluster
  // state - so there is no reason to make the user ask for it.
  const key = JSON.stringify(form);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      discoveryApi
        .getBaseUrl('devspaces-self-service')
        .then(base => fetchPlan(base, fetchApi.fetch, form, ac.signal))
        .then(p => {
          setPlan(p);
          setPlanError(undefined);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setPlan(null);
          setPlanError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const base = await discoveryApi.getBaseUrl('devspaces-self-service');
      setResult(await provision(base, fetchApi.fetch, form));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [discoveryApi, fetchApi, form]);

  const toggleAgent = (id: string, on: boolean) =>
    set('agents', on ? [...form.agents, id] : form.agents.filter(a => a !== id));

  const thirdParty = form.ai.kind === 'third-party';
  const canSubmit = plan !== null && !planError && !submitting;

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={7}>
        <Stack spacing={3}>
          {capsError && (
            <Alert severity="error">
              <AlertTitle>Could not read what this cluster offers</AlertTitle>
              {capsError}
            </Alert>
          )}

          {caps?.problems.map(p => (
            <Alert severity="warning" key={p}>
              <Typography variant="caption">{p}</Typography>
            </Alert>
          ))}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              How much do you need?
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Totals across all your workspaces. They are divided evenly, and the
              editor itself takes a share &mdash; the panel on the right shows what
              each workspace actually gets.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}>
                <TextField
                  label="Workspaces"
                  type="number"
                  fullWidth
                  size="small"
                  inputProps={{ min: 1, max: 20 }}
                  value={form.workspaceCount}
                  onChange={e => set('workspaceCount', Math.max(1, Number(e.target.value)))}
                  helperText="How many you can run at once"
                />
              </Grid>
              <Grid item xs={6} sm={4}>
                <TextField
                  label="Total vCPU"
                  type="number"
                  fullWidth
                  size="small"
                  inputProps={{ min: 1, step: 1 }}
                  value={form.totalVcpu}
                  onChange={e => set('totalVcpu', Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={6} sm={4}>
                <TextField
                  label="Total memory (GiB)"
                  type="number"
                  fullWidth
                  size="small"
                  inputProps={{ min: 1, step: 1 }}
                  value={form.totalRamGiB}
                  onChange={e => set('totalRamGiB', Number(e.target.value))}
                />
              </Grid>

              <Grid item xs={6} sm={4}>
                <TextField
                  select
                  label="Storage"
                  fullWidth
                  size="small"
                  SelectProps={{ native: true }}
                  InputLabelProps={{ shrink: true }}
                  value={form.storageMode}
                  onChange={e =>
                    set('storageMode', e.target.value as DevSpaceRequestInput['storageMode'])
                  }
                >
                  <option value="persistent">Persistent</option>
                  <option value="ephemeral">Ephemeral</option>
                </TextField>
              </Grid>
              <Grid item xs={6} sm={4}>
                <TextField
                  label="Size per workspace (GiB)"
                  type="number"
                  fullWidth
                  size="small"
                  disabled={form.storageMode === 'ephemeral'}
                  inputProps={{ min: 1 }}
                  value={form.storageGiB}
                  onChange={e => set('storageGiB', Number(e.target.value))}
                  helperText={
                    form.storageMode === 'ephemeral' ? 'Lost on restart' : '/projects survives'
                  }
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Git repository (optional)"
                  fullWidth
                  size="small"
                  placeholder="https://github.com/org/repo"
                  value={form.repoUrl ?? ''}
                  onChange={e => set('repoUrl', e.target.value || undefined)}
                  helperText="Cloned on first start"
                />
              </Grid>
            </Grid>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              AI assistant
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Already in the workspace image, so nothing is downloaded when a
              workspace starts.
            </Typography>

            {caps?.agents.length === 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                <Typography variant="caption">
                  No assistants are available. The cluster has no custom workspace
                  image published &mdash; see demo-custom-udi.
                </Typography>
              </Alert>
            )}

            {caps?.agents.map(a => (
              <Box key={a.id}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    control={
                      <Checkbox
                        checked={form.agents.includes(a.id)}
                        onChange={e => toggleAgent(a.id, e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">{a.displayName}</Typography>}
                  />
                  <Chip size="small" variant="outlined" label={a.version} />
                  {!a.editorOnly && (
                    <Chip size="small" variant="outlined" label="also a terminal CLI" />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ pl: 4 }} display="block">
                  {a.description}
                </Typography>
              </Box>
            ))}

            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  label="Model endpoint"
                  fullWidth
                  size="small"
                  SelectProps={{ native: true }}
                  InputLabelProps={{ shrink: true }}
                  value={form.ai.kind}
                  onChange={e =>
                    set('ai', { kind: e.target.value as DevSpaceRequestInput['ai']['kind'] })
                  }
                >
                  <option value="none">None</option>
                  <option value="in-cluster" disabled={!caps?.inClusterAi}>
                    In-cluster model
                    {caps?.inClusterAi ? '' : ' (not deployed on this cluster)'}
                  </option>
                  <option value="third-party">Third-party endpoint</option>
                </TextField>
              </Grid>

              {thirdParty && (
                <>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Base URL"
                      fullWidth
                      size="small"
                      placeholder="https://api.example.com/v1"
                      value={form.ai.baseUrl ?? ''}
                      onChange={e => set('ai', { ...form.ai, baseUrl: e.target.value })}
                      helperText="OpenAI-compatible, https only"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="API key"
                      type="password"
                      fullWidth
                      size="small"
                      value={form.ai.apiKey ?? ''}
                      onChange={e => set('ai', { ...form.ai, apiKey: e.target.value })}
                      helperText="Stored as a Secret, never written to the devfile"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Model (optional)"
                      fullWidth
                      size="small"
                      value={form.ai.model ?? ''}
                      onChange={e => set('ai', { ...form.ai, model: e.target.value })}
                    />
                  </Grid>
                </>
              )}
            </Grid>
          </Paper>

          <Box>
            <Button
              variant="contained"
              size="large"
              disabled={!canSubmit}
              onClick={onSubmit}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting ? 'Creating…' : 'Create my Dev Space'}
            </Button>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              This creates a namespace and quota on the cluster, in your name.
            </Typography>
          </Box>

          {submitError && (
            <Alert severity="error">
              <AlertTitle>Nothing was created</AlertTitle>
              {submitError}
            </Alert>
          )}

          {result && (
            <Alert severity="success">
              <AlertTitle>Namespace {result.namespace} is ready</AlertTitle>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {result.applied.map(a => (
                  <Typography component="li" variant="caption" key={`${a.kind}-${a.name}`}>
                    {a.created ? 'Created' : 'Updated'} {a.kind} {a.name}
                  </Typography>
                ))}
              </Box>
            </Alert>
          )}
        </Stack>
      </Grid>

      <Grid item xs={12} md={5}>
        <PlanPanel plan={plan} loading={loading} error={planError} cheUrl={caps?.cheUrl} />
      </Grid>
    </Grid>
  );
}
