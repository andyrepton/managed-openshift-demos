import React from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { CostEstimate, CostLine } from '@aro-planner/common';

const money = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Every figure carries where it came from. A price Azure published and a number we
 * assumed must never look alike - that distinction is what makes the panel worth
 * trusting.
 */
function SourceChip({ line }: { line: CostLine }) {
  if (!line.included) return <Chip size="small" variant="outlined" label="excluded" />;
  if (line.source === 'azure-api') return <Chip size="small" color="success" label="live" />;
  if (line.source === 'override') return <Chip size="small" color="primary" label="configured" />;
  return <Chip size="small" color="warning" label="assumed" />;
}

export interface CostPanelProps {
  estimate: CostEstimate | null;
  loading: boolean;
  error?: string | undefined;
  warning?: string | undefined;
  stale: boolean;
  retrievedAt?: string | undefined;
}

export function CostPanel({
  estimate,
  loading,
  error,
  warning,
  stale,
  retrievedAt,
}: CostPanelProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, position: 'sticky', top: 16 }}
      aria-live="polite"
      aria-busy={loading}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h6">Estimated cost</Typography>
        {loading && <CircularProgress size={16} aria-label="Updating estimate" />}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {warning && !error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {warning}
        </Alert>
      )}
      {stale && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Azure was unreachable, so these are cached prices
          {retrievedAt ? ` from ${new Date(retrievedAt).toLocaleString()}` : ''}.
        </Alert>
      )}

      {!estimate && !error && !warning && (
        <Typography variant="body2" color="text.secondary">
          Fill in the form to see a price.
        </Typography>
      )}

      {estimate && (
        <>
          <Box textAlign="center" py={2}>
            <Typography variant="h3" component="div" fontWeight={700}>
              ${money(estimate.monthly)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              per month
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              ${money(estimate.hourly, 4)}/hour &middot; ${money(estimate.yearly)}/year
            </Typography>
          </Box>

          <Divider />

          <Stack divider={<Divider flexItem />} spacing={0}>
            {estimate.lines.map(line => (
              <Stack
                key={line.label}
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                spacing={1}
                py={1}
                sx={{ opacity: line.included ? 1 : 0.6 }}
              >
                <Box flex={1} minWidth={0}>
                  <Typography variant="body2" fontWeight={600}>
                    {line.label}
                  </Typography>
                  {line.detail && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {line.detail}
                    </Typography>
                  )}
                  {line.sourceNote && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {line.sourceNote}
                    </Typography>
                  )}
                </Box>
                <Box textAlign="right" flexShrink={0}>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {line.included ? `$${money(line.hourly, 4)}/hr` : '--'}
                  </Typography>
                  <SourceChip line={line} />
                </Box>
              </Stack>
            ))}
          </Stack>

          {estimate.assumptions.length > 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Before you quote this
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {estimate.assumptions.map(a => (
                  <Typography component="li" variant="caption" key={a}>
                    {a}
                  </Typography>
                ))}
              </Box>
            </Alert>
          )}

          <Typography variant="caption" color="text.secondary" display="block" mt={2}>
            {estimate.currency} list price, {estimate.hoursPerMonth} hours/month. No
            reserved-instance or enterprise agreement discounts applied.
          </Typography>
        </>
      )}
    </Paper>
  );
}
