import React from 'react';

import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { PlanResponse } from '../api/client';

const cpu = (milli: number) => (milli % 1000 === 0 ? `${milli / 1000}` : `${milli}m`);
const mem = (miB: number) => (miB % 1024 === 0 ? `${miB / 1024} GiB` : `${miB} MiB`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={1} py={0.5}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export interface PlanPanelProps {
  plan: PlanResponse | null;
  loading: boolean;
  error?: string | undefined;
  cheUrl?: string | undefined;
}

export function PlanPanel({ plan, loading, error, cheUrl }: PlanPanelProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2, position: 'sticky', top: 16 }} aria-live="polite">
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h6">What you will get</Typography>
        {loading && <CircularProgress size={16} aria-label="Updating" />}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="caption">{error}</Typography>
        </Alert>
      )}

      {!plan && !error && (
        <Typography variant="body2" color="text.secondary">
          Fill in the form to see the namespace and quota.
        </Typography>
      )}

      {plan && (
        <>
          <Box textAlign="center" py={1}>
            <Typography variant="h5" component="div" fontWeight={700}>
              {plan.namespace}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              your Dev Spaces namespace
            </Typography>
          </Box>

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2" gutterBottom>
            Each workspace
          </Typography>
          <Row label="CPU" value={`${cpu(plan.sizing.perWorkspace.cpuLimitMilli)} limit`} />
          <Row label="Memory" value={`${mem(plan.sizing.perWorkspace.ramLimitMiB)} limit`} />
          <Row
            label="Reserved"
            value={`${cpu(plan.sizing.perWorkspace.cpuRequestMilli)} / ${mem(
              plan.sizing.perWorkspace.ramRequestMiB,
            )}`}
          />

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2" gutterBottom>
            Namespace quota
          </Typography>
          <Row label="CPU ceiling" value={cpu(plan.sizing.quota.limitsCpuMilli)} />
          <Row label="Memory ceiling" value={mem(plan.sizing.quota.limitsRamMiB)} />
          <Row label="Pods" value={String(plan.sizing.quota.pods)} />
          {plan.sizing.quota.persistentVolumeClaims > 0 && (
            <Row
              label="Storage"
              value={`${plan.sizing.quota.requestsStorageGiB} GiB across ${plan.sizing.quota.persistentVolumeClaims} PVCs`}
            />
          )}

          {plan.warnings.length > 0 && (
            <Accordion
              variant="outlined"
              disableGutters
              sx={{ mt: 2, '&:before': { display: 'none' } }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon fontSize="small" />}
                sx={{ flexDirection: 'row-reverse', gap: 1, minHeight: 40 }}
              >
                <Typography variant="subtitle2">
                  Before you submit
                  <Typography component="span" variant="caption">
                    {' '}
                    &mdash; {plan.warnings.length}{' '}
                    {plan.warnings.length === 1 ? 'note' : 'notes'}
                  </Typography>
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {plan.warnings.map(w => (
                    <Typography component="li" variant="caption" key={w} display="block">
                      {w}
                    </Typography>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          <Accordion
            variant="outlined"
            disableGutters
            sx={{ mt: 1, '&:before': { display: 'none' } }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon fontSize="small" />}
              sx={{ flexDirection: 'row-reverse', gap: 1, minHeight: 40 }}
            >
              <Typography variant="subtitle2">
                Objects
                <Typography component="span" variant="caption">
                  {' '}
                  &mdash; {plan.files.filter(f => f.applied).length} applied,{' '}
                  {plan.files.filter(f => !f.applied).length} for you
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={1}>
                {plan.files.map(f => (
                  <Box key={f.path}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" fontWeight={600}>
                        {f.path}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={f.applied ? 'primary' : 'default'}
                        label={f.applied ? 'applied' : 'yours to use'}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {f.purpose}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>

          {cheUrl && (
            <Typography variant="caption" color="text.secondary" display="block" mt={2}>
              Dev Spaces dashboard:{' '}
              <Link href={cheUrl} target="_blank" rel="noopener">
                {cheUrl.replace(/^https:\/\//, '')}
              </Link>
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
}
