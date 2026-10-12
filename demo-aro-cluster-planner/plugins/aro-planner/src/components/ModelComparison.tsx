import React from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { ModelComparisonDto } from '../api/client';

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Side-by-side comparison of where a workload could run.
 *
 * The visual job is to stop an invented figure reading like a market price. Only
 * the dedicated ARO column comes from a real meter; the other two are multiples of
 * it, made up for the demo. They must not look alike, or the tool quietly argues
 * for whichever option had the friendlier multiplier.
 */
export interface ModelComparisonProps {
  comparison: ModelComparisonDto[];
  cheapest: string | null;
  loading: boolean;
}

export function ModelComparison({ comparison, cheapest, loading }: ModelComparisonProps) {
  if (comparison.length === 0) return null;

  const anyAssumed = comparison.some(c =>
    (c.estimate?.lines ?? []).some(l => l.source === 'assumption'),
  );
  const cols = comparison.length === 1 ? 12 : 6;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        What this would cost
      </Typography>

      <Grid container spacing={2} alignItems="stretch">
        {comparison.map(c => {
          const isAzure = (c.estimate?.lines ?? []).some(l => l.source === 'azure-api');
          const isCheapest = cheapest === c.model;
          const oneOff = c.billing === 'one-off';

          return (
            <Grid item xs={12} md={cols} key={c.model} sx={{ display: 'flex' }}>
              <Card
                variant="outlined"
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: loading ? 0.6 : 1,
                  borderColor: isCheapest ? 'success.main' : undefined,
                  borderWidth: isCheapest ? 2 : 1,
                  // Dashed = this number was invented, not measured.
                  borderStyle: isAzure ? 'solid' : 'dashed',
                }}
              >
                <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mb={1}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {c.label}
                    </Typography>
                    {isCheapest && <Chip size="small" color="success" label="lower cost" />}
                  </Stack>

                  <Typography variant="h4" component="div" fontWeight={700}>
                    ${money(c.amount ?? 0)}
                    <Typography component="span" variant="body2" color="text.secondary">
                      {oneOff ? ' one-off' : ' /month'}
                    </Typography>
                  </Typography>

                  <Box mt={0.5}>
                    {isAzure ? (
                      <Chip size="small" color="success" label="live Azure price" />
                    ) : (
                      <Chip size="small" color="warning" label="assumed - demo figure" />
                    )}
                    {oneOff && (
                      <Chip size="small" variant="outlined" sx={{ ml: 0.5 }} label="paid once" />
                    )}
                  </Box>

                  <Typography variant="body2" color="text.secondary" mt={1.5}>
                    {c.summary}
                  </Typography>

                  <Divider sx={{ my: 1.5 }} />

                  <Box component="ul" sx={{ m: 0, pl: 2, flex: 1 }}>
                    {c.tradeoffs.map(t => (
                      <Typography component="li" variant="caption" color="text.secondary" key={t}>
                        {t}
                      </Typography>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {anyAssumed && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <strong>Figures marked "assumed" are invented for this demo.</strong> Only the
          dedicated ARO cluster is priced from the Azure Retail Prices API. A shared
          namespace is shown at 50% of it and on-premises at 5x as a one-off purchase —
          multipliers chosen to make the comparison concrete, not measured, not
          benchmarked, and not Red Hat guidance. Replace them with your own figures
          before using this to decide anything.
        </Alert>
      )}
    </Box>
  );
}
