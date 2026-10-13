import React, { useRef } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { EndpointInput, NetworkPlan } from '../api/client';

/**
 * Connectivity the team needs, turned into NetworkPolicies.
 *
 * Deliberately phrased as "what does it talk to", not "write me a policy" - the
 * point of the tool is that someone who does not know NetworkPolicy can still get
 * a correct one. Where NetworkPolicy genuinely cannot express an intent the
 * generator says so rather than emitting a rule that looks right and is not.
 */

const TARGETS = [
  { id: 'internet', label: 'The public internet' },
  { id: 'namespace', label: 'Another namespace on this cluster' },
  { id: 'on-premises', label: 'An on-premises network' },
  { id: 'azure-service', label: 'An Azure service (SQL, Storage, Key Vault...)' },
] as const;

export interface NetworkSectionProps {
  endpoints: EndpointInput[];
  onChange: (endpoints: EndpointInput[]) => void;
  networkPlan: NetworkPlan | null;
}

function blank(): EndpointInput {
  return { name: '', direction: 'egress', target: { kind: 'internet' } };
}

/**
 * A stable React key per row.
 *
 * Index keys were wrong here: removing the middle of three rows shifts every
 * later index, so React reuses the wrong DOM node and focus lands in a
 * different connection's field than the one being edited. The name cannot be
 * the key either - it is empty on a new row and changes as it is typed.
 *
 * So identity is tracked out of band, in a WeakMap keyed on the endpoint object.
 * Rows that arrive without one - a new row, or one the assistant added - get an
 * id on first render and keep it, because `update` copies the object and the
 * copy is registered against the same id.
 */
function useRowKeys() {
  const keys = useRef(new WeakMap<object, string>());
  const next = useRef(0);
  return (ep: EndpointInput, previous?: EndpointInput) => {
    const existing = keys.current.get(ep);
    if (existing) return existing;
    const inherited = previous ? keys.current.get(previous) : undefined;
    const id = inherited ?? `row-${next.current++}`;
    keys.current.set(ep, id);
    return id;
  };
}

export function NetworkSection({ endpoints, onChange, networkPlan }: NetworkSectionProps) {
  const rowKey = useRowKeys();
  const previous = useRef<EndpointInput[]>([]);

  const update = (i: number, next: Partial<EndpointInput>) =>
    onChange(endpoints.map((e, j) => (j === i ? { ...e, ...next } : e)));

  // Resolve keys against last render's list, then record this one. Done before
  // the JSX so the order is explicit rather than depending on when the map runs.
  const keys = endpoints.map((ep, i) => rowKey(ep, previous.current[i]));
  previous.current = endpoints;

  const setTargetKind = (i: number, kind: EndpointInput['target']['kind']) => {
    const target: EndpointInput['target'] =
      kind === 'namespace'
        ? { kind, namespace: '' }
        : kind === 'on-premises'
          ? { kind, cidrs: [] }
          : kind === 'azure-service'
            ? { kind, service: '' }
            : { kind: 'internet' };
    update(i, { target });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Network connections</Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        What does this application need to talk to? Nothing is allowed unless you
        list it here.
      </Typography>

      <Stack spacing={1.5}>
        {endpoints.map((ep, i) => (
          <Box
            key={keys[i]}
            sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            <Grid container spacing={1.5} alignItems="flex-start">
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Name" size="small" fullWidth
                  placeholder="payments-db"
                  value={ep.name}
                  onChange={e => update(i, { name: e.target.value })}
                />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField
                  select label="Direction" size="small" fullWidth
                  SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
                  value={ep.direction}
                  onChange={e => update(i, { direction: e.target.value as EndpointInput['direction'] })}
                >
                  <option value="egress">Outbound to</option>
                  <option value="ingress">Inbound from</option>
                </TextField>
              </Grid>
              <Grid item xs={6} sm={4}>
                <TextField
                  select label="Target" size="small" fullWidth
                  SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
                  value={ep.target.kind}
                  onChange={e => setTargetKind(i, e.target.value as EndpointInput['target']['kind'])}
                >
                  {TARGETS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={10} sm={2}>
                <TextField
                  label="Port" size="small" fullWidth type="number"
                  placeholder="443"
                  value={ep.ports?.[0]?.port ?? ''}
                  onChange={e => {
                    const port = Number(e.target.value);
                    update(i, { ports: port > 0 ? [{ protocol: 'TCP', port }] : [] });
                  }}
                />
              </Grid>
              <Grid item xs={2} sm={1}>
                <IconButton
                  aria-label={`Remove ${ep.name || 'connection'}`}
                  onClick={() => onChange(endpoints.filter((_, j) => j !== i))}
                >
                  ✕
                </IconButton>
              </Grid>

              {ep.target.kind === 'namespace' && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Namespace" size="small" fullWidth
                    placeholder="shared-services"
                    value={ep.target.namespace ?? ''}
                    onChange={e => update(i, { target: { kind: 'namespace', namespace: e.target.value } })}
                  />
                </Grid>
              )}
              {ep.target.kind === 'on-premises' && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="On-premises CIDRs" size="small" fullWidth
                    placeholder="192.168.10.0/24, 10.50.0.0/16"
                    value={(ep.target.cidrs ?? []).join(', ')}
                    onChange={e =>
                      update(i, {
                        target: {
                          kind: 'on-premises',
                          cidrs: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                        },
                      })
                    }
                  />
                </Grid>
              )}
              {ep.target.kind === 'azure-service' && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Azure service" size="small" fullWidth
                    placeholder="Sql"
                    value={ep.target.service ?? ''}
                    onChange={e => update(i, { target: { kind: 'azure-service', service: e.target.value } })}
                  />
                </Grid>
              )}
            </Grid>
          </Box>
        ))}
      </Stack>

      <Button sx={{ mt: 1.5 }} onClick={() => onChange([...endpoints, blank()])}>
        + Add a connection
      </Button>

      {networkPlan && (
        <Box mt={2}>
          {/* Caveats stay visible: they are things the platform team must act on,
              not detail the user can skip. */}
          {networkPlan.caveats.map(c => (
            <Alert severity="warning" sx={{ mb: 1 }} key={c}>
              <Typography variant="caption">{c}</Typography>
            </Alert>
          ))}

          <Accordion variant="outlined" disableGutters sx={{ mt: 1 }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon fontSize="small" />}
              sx={{
                // Flip the chevron to the left of the label and give it room, so
                // it reads as a disclosure control rather than sitting flush
                // against the border.
                flexDirection: 'row-reverse',
                gap: 1,
                px: 2,
                minHeight: 44,
                '& .MuiAccordionSummary-content': { my: 1 },
                '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
                  transform: 'rotate(180deg)',
                },
              }}
            >
              <Typography variant="body2">
                Detailed changes
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}— {networkPlan.policies.length} network rules and cluster settings
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" mb={1.5}>
                <Chip size="small" variant="outlined" label={`API server: ${networkPlan.clusterSettings.apiVisibility}`} />
                <Chip size="small" variant="outlined" label={`Ingress: ${networkPlan.clusterSettings.ingressVisibility}`} />
                <Chip size="small" variant="outlined" label={`Egress: ${networkPlan.clusterSettings.outboundType}`} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                NetworkPolicies generated for namespace <code>{networkPlan.namespace}</code>:
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                {networkPlan.policies.map(p => (
                  <Typography component="li" variant="caption" color="text.secondary" key={p.metadata.name}>
                    <code>{p.metadata.name}</code>
                  </Typography>
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Paper>
  );
}
