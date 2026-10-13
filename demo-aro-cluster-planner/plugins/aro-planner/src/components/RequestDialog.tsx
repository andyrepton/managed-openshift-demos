import React, { useEffect, useState } from 'react';

import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

import { fetchArtifacts, type EmitBundle, type PlanInput, type PlanResponse } from '../api/client';

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MODEL_LABEL: Record<string, string> = {
  'shared-namespace': 'Namespace on a shared cluster',
  'dedicated-cluster': 'Dedicated ARO cluster',
  'on-premises': 'On-premises OpenShift',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} py={0.5}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} textAlign="right">{value}</Typography>
    </Stack>
  );
}

export interface RequestDialogProps {
  open: boolean;
  onClose: () => void;
  form: PlanInput;
  plan: PlanResponse | null;
}

/**
 * Review step before a request goes to the platform team.
 *
 * Submission is deliberately not wired up. Publishing opens a pull request, which
 * needs a stored write credential, and this instance allows guest sign-in - a
 * write credential reachable by anyone who can load the page is not a combination
 * worth shipping. The button says so rather than failing silently.
 *
 * The dialog itself does not explain any of that. The reasoning belongs in the
 * code and the README; a visitor only needs to know the button is off.
 */
export function RequestDialog({ open, onClose, form, plan }: RequestDialogProps) {
  const chosen = plan?.comparison.find(c => c.model === form.deploymentModel);
  const onPrem = form.deploymentModel === 'on-premises';

  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [bundle, setBundle] = useState<EmitBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | undefined>();

  // Generated on open rather than on every keystroke - nobody is reading the
  // manifests while they drag a vCPU field around.
  useEffect(() => {
    if (!open) {
      setBundle(null);
      setBundleError(undefined);
      return undefined;
    }
    const ac = new AbortController();
    discoveryApi
      .getBaseUrl('aro-planner')
      .then(base => fetchArtifacts(base, fetchApi.fetch, form, ac.signal))
      .then(setBundle)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setBundleError(err instanceof Error ? err.message : String(err));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(form)]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Request: {form.applicationName}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" gutterBottom>What you are asking for</Typography>
        <Row label="Application" value={form.applicationName} />
        <Row label="Deployment model" value={MODEL_LABEL[form.deploymentModel] ?? form.deploymentModel} />
        <Row label="Capacity" value={`${form.vcpu} vCPU / ${form.ramGiB} GiB allocatable`} />
        {!onPrem && (
          <>
            <Row label="Architecture" value={form.flavour === 'hcp' ? 'ARO hosted control planes' : 'ARO standard'} />
            <Row label="Region" value={form.region} />
            <Row label="Availability zones" value={form.highAvailability ? 'Spread across three' : 'Single zone'} />
            {plan?.recommendations[0] && (
              <Row
                label="Node pool"
                value={`${plan.recommendations[0].nodes} x ${plan.recommendations[0].sku.name}`}
              />
            )}
          </>
        )}

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" gutterBottom>Cost</Typography>
        {chosen ? (
          <>
            <Box textAlign="center" py={1}>
              <Typography variant="h4" fontWeight={700}>
                ${money(chosen.amount ?? 0)}
                <Typography component="span" variant="body2" color="text.secondary">
                  {chosen.billing === 'one-off' ? ' one-off' : ' /month'}
                </Typography>
              </Typography>
            </Box>
            {(chosen.estimate?.assumptions ?? []).map(a => (
              <Alert severity="warning" sx={{ mb: 1 }} key={a}>
                <Typography variant="caption">{a}</Typography>
              </Alert>
            ))}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">No costing available.</Typography>
        )}

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" gutterBottom>
          What would be created
        </Typography>
        {bundleError && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            <Typography variant="caption">{bundleError}</Typography>
          </Alert>
        )}
        {!bundle && !bundleError && (
          <Stack direction="row" spacing={1} alignItems="center" py={1}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Generating the files&hellip;
            </Typography>
          </Stack>
        )}
        {bundle && (
          <Box mb={1.5}>
            {bundle.files.map(f => (
              <Accordion key={f.path} variant="outlined" disableGutters>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon fontSize="small" />}
                  sx={{
                    flexDirection: 'row-reverse',
                    gap: 1,
                    px: 2,
                    minHeight: 40,
                    '& .MuiAccordionSummary-content': { my: 0.75 },
                  }}
                >
                  <Typography variant="body2" fontFamily="monospace">
                    {f.path}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 2, pt: 0 }}>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      maxHeight: 280,
                      overflow: 'auto',
                      fontSize: 11,
                      lineHeight: 1.5,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    {f.contents}
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}

        <Alert severity="info">
          <Typography variant="caption">
            <strong>Submission is not enabled on this instance.</strong> Sending a
            request opens a pull request for the platform team, which needs a
            configured git integration. Until then, this is the summary to hand over.
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled title="Needs authentication before it can publish">
          Submit request
        </Button>
      </DialogActions>
    </Dialog>
  );
}
