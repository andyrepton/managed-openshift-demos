import React from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { PlanInput, PlanResponse } from '../api/client';

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
 * needs a stored GitHub credential, and this instance allows guest sign-in - a
 * write credential reachable by anyone who can load the page is not a combination
 * worth shipping. The button says so rather than failing silently.
 */
export function RequestDialog({ open, onClose, form, plan }: RequestDialogProps) {
  const chosen = plan?.comparison.find(c => c.model === form.deploymentModel);
  const onPrem = form.deploymentModel === 'on-premises';

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

        <Alert severity="info">
          <Typography variant="caption">
            <strong>Submission is not enabled on this instance.</strong> Sending a request
            to the platform team opens a pull request, which requires a stored GitHub
            credential. This demo allows guest sign-in, so that step is disabled until
            authentication is configured.
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
