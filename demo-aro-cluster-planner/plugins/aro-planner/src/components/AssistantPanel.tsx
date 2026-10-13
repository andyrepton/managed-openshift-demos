import React, { useEffect, useMemo, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import SendIcon from '@mui/icons-material/Send';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

import {
  fetchAssistantStatus,
  sendChat,
  type AssistantStatus,
  type ChatMessage,
  type FormAction,
} from '../api/assistant';
import type { PlanInput } from '../api/client';

/**
 * In-page assistant, pinned above the form.
 *
 * It both answers and acts: the backend runs a tool loop over the same engine
 * the page uses, and returns patches that are applied to the form here. That is
 * why it lives in the plugin rather than using RHDH's global Lightspeed drawer -
 * that one is mounted in a separate React tree with no access to this state.
 *
 * When no model endpoint is configured it renders disabled with the reason,
 * rather than offering an input that accepts text and discards it.
 */

const EXAMPLES = [
  'Payments team, 50 users, needs our on-prem Oracle',
  'Is a namespace enough, or do we need our own cluster?',
  'Make it highly available — what does that cost?',
];

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  actions?: FormAction[];
  error?: boolean;
}

export interface AssistantPanelProps {
  /** The form as it stands, sent with every turn. */
  state: PlanInput;
  /** Apply what the assistant changed. */
  onApply: (patch: Partial<PlanInput>) => void;
}

export function AssistantPanel({ state, onApply }: AssistantPanelProps) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // The form changes constantly; the send handler must see the current value
  // without being rebuilt (and without re-triggering anything) on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const ac = new AbortController();
    discoveryApi
      .getBaseUrl('aro-planner')
      .then(base => fetchAssistantStatus(base, fetchApi.fetch, ac.signal))
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, reason: 'Could not reach the planner backend.' }));
    return () => ac.abort();
  }, [discoveryApi, fetchApi]);

  const enabled = status?.enabled === true;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !enabled) return;

    const history: ChatMessage[] = [
      ...turns.filter(t => !t.error).map(t => ({ role: t.role, content: t.content })),
      { role: 'user', content: message },
    ];
    setTurns(t => [...t, { role: 'user', content: message }]);
    setDraft('');
    setBusy(true);

    try {
      const base = await discoveryApi.getBaseUrl('aro-planner');
      const res = await sendChat(base, fetchApi.fetch, history, stateRef.current);

      // Apply in order. Each is a shallow patch, so a later one wins where they
      // touch the same field - which is what the assistant intended.
      for (const action of res.actions) onApply(action.patch);

      setTurns(t => [
        ...t,
        { role: 'assistant', content: res.reply, actions: res.actions },
      ]);
    } catch (err) {
      setTurns(t => [
        ...t,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : String(err),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const placeholder = useMemo(() => {
    if (status === null) return 'Checking…';
    return enabled
      ? 'Describe what you need — capacity, connectivity, constraints…'
      : 'Not available on this instance';
  }, [status, enabled]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
        <Typography variant="h6">Ask the assistant</Typography>
        {status !== null &&
          (enabled ? (
            <Chip size="small" variant="outlined" color="success" label={status.model ?? 'connected'} />
          ) : (
            <Chip size="small" variant="outlined" label="not connected" />
          ))}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          Describe your needs in plain English and it will fill the form in for you
        </Typography>
      </Stack>

      {status !== null && !enabled && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          <Typography variant="caption">{status.reason}</Typography>
        </Alert>
      )}

      {turns.length > 0 && (
        <Stack spacing={1} mb={1.5} sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {turns.map((t, i) => (
            <Box
              key={`${i}-${t.content.slice(0, 24)}`}
              sx={{
                p: 1.25,
                borderRadius: 1,
                bgcolor: t.role === 'user' ? 'action.hover' : 'transparent',
                border: t.role === 'assistant' ? 1 : 0,
                borderColor: t.error ? 'error.main' : 'divider',
              }}
            >
              <Typography
                variant="body2"
                color={t.error ? 'error.main' : 'text.primary'}
                sx={{ whiteSpace: 'pre-wrap' }}
              >
                {t.content}
              </Typography>
              {/* What it changed, so a silent edit to the form is never a surprise. */}
              {(t.actions ?? []).length > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap mt={1}>
                  {t.actions!.map(a => (
                    <Chip
                      key={`${a.tool}-${a.describe}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={a.describe}
                    />
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={3}
          disabled={!enabled || busy}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Enter sends, Shift+Enter is a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={placeholder}
          aria-label="Assistant input"
        />
        <IconButton
          disabled={!enabled || busy || draft.trim() === ''}
          onClick={() => void send(draft)}
          aria-label="Send"
          sx={{ mt: 0.25 }}
        >
          {busy ? <CircularProgress size={18} /> : <SendIcon fontSize="small" />}
        </IconButton>
      </Stack>

      {turns.length === 0 && (
        <Box mt={1.5}>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {EXAMPLES.map(e => (
              <Chip
                key={e}
                size="small"
                variant="outlined"
                label={e}
                disabled={!enabled || busy}
                onClick={enabled ? () => void send(e) : undefined}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
