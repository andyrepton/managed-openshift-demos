import React, { useEffect, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

import { operatorFootprint } from '@aro-planner/common';

import { fetchOperators, type OperatorEntry, type OperatorId } from '../api/client';

/**
 * Whether this cluster can actually install the thing.
 *
 * "Not in this cluster's catalog" and "we could not check" are different
 * answers and get different chips. Collapsing them would let a plan ask for
 * something uninstallable and look fine doing it.
 */
function AvailabilityChip({ entry }: { entry: OperatorEntry }) {
  const { availability, version, catalog, reason } = entry.status;

  if (availability === 'available') {
    return (
      <Tooltip title={`Served by ${catalog ?? 'a catalog'} on this cluster`}>
        <Chip size="small" color="success" label={version ? `in catalog - ${version}` : 'in catalog'} />
      </Tooltip>
    );
  }
  if (availability === 'missing') {
    return (
      <Tooltip title={`No package named ${entry.packageName} in this cluster's catalogs`}>
        <Chip size="small" color="error" label="not in catalog" />
      </Tooltip>
    );
  }
  return (
    <Tooltip title={reason ?? 'Availability could not be checked'}>
      <Chip size="small" variant="outlined" label="not checked" />
    </Tooltip>
  );
}

export interface OperatorSectionProps {
  selected: OperatorId[];
  onChange: (ids: OperatorId[]) => void;
}

export function OperatorSection({ selected, onChange }: OperatorSectionProps) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const [entries, setEntries] = useState<OperatorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const ac = new AbortController();
    discoveryApi
      .getBaseUrl('aro-planner')
      .then(baseUrl => fetchOperators(baseUrl, fetchApi.fetch, ac.signal))
      .then(setEntries)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // The list does not depend on the form, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: OperatorId, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter(s => s !== id));

  // Computed from the same function the backend sizes with, so the figure the
  // user reads here and the capacity they are charged for cannot diverge.
  const footprint = operatorFootprint(selected);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h6">Operators</Typography>
        {loading && <CircularProgress size={16} aria-label="Checking the operator catalog" />}
      </Stack>

      <Typography variant="body2" color="text.secondary" gutterBottom>
        Platform services the team can ask for. Selecting one adds its capacity to
        the cluster being sized, because an operator runs pods like anything else.
      </Typography>

      {error && (
        <Alert severity="warning" sx={{ my: 1 }}>
          <Typography variant="caption">
            The operator list could not be loaded: {error}
          </Typography>
        </Alert>
      )}

      <Stack spacing={0.5} mt={1}>
        {entries.map(entry => (
          <Box key={entry.id}>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <FormControlLabel
                sx={{ mr: 0 }}
                control={
                  <Checkbox
                    checked={selected.includes(entry.id)}
                    // A missing package is still selectable. The platform team
                    // may be about to add the catalog, and a plan that records
                    // the need is more useful than a disabled checkbox that
                    // records nothing.
                    onChange={e => toggle(entry.id, e.target.checked)}
                  />
                }
                label={<Typography variant="body2">{entry.label}</Typography>}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${entry.vcpu} vCPU / ${entry.ramGiB} GiB`}
              />
              <AvailabilityChip entry={entry} />
              {!entry.supported && (
                <Tooltip title={`From ${entry.catalog}, which Red Hat does not support`}>
                  <Chip size="small" color="warning" label="community" />
                </Tooltip>
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ pl: 4, pb: 0.5 }}
            >
              {entry.breakdown} {entry.sourceNote}
            </Typography>
          </Box>
        ))}
      </Stack>

      {footprint.items.length > 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          <Typography variant="caption">
            Adding <strong>{footprint.vcpu} vCPU</strong> and{' '}
            <strong>{footprint.ramGiB} GiB</strong> to the capacity above. These are
            documented vendor figures for a default install, not measurements, and a
            real deployment should replace them with its own.
          </Typography>
        </Alert>
      )}

      {footprint.hasUnsupported && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Typography variant="caption">
            A selected operator comes from the community catalog. It installs, but it
            carries no Red Hat support, and on a managed cluster that is a decision
            someone has to own.
          </Typography>
        </Alert>
      )}
    </Paper>
  );
}
