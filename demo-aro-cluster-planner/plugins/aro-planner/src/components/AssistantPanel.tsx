import React from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import SendIcon from '@mui/icons-material/Send';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * In-page assistant, pinned above the form.
 *
 * Deliberately inert for now: it holds the position and shows what it will do
 * without pretending to work. An input that accepts text and silently discards it
 * is worse than one that says it is not connected.
 *
 * When built, it talks to a model through the backend plugin with two kinds of
 * tool: the read-only ones already exposed over MCP (recommend_node_pools,
 * estimate_cost, suggest_network_policies, lookup_aro_doc) plus actions that write
 * back to this form. It lives inside the plugin rather than using RHDH's global
 * assistant because that one is mounted in a separate React tree and cannot reach
 * this component's state - it could advise, but not fill anything in.
 */
const EXAMPLES = [
  'Payments team, 50 users, needs our on-prem Oracle',
  'Is a namespace enough, or do we need our own cluster?',
  'Make it highly available — what does that cost?',
];

export function AssistantPanel() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
        <Typography variant="h6">Ask the assistant</Typography>
        <Chip size="small" variant="outlined" label="not connected" />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          Will describe your needs in plain English and fill the form in for you
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={3}
          disabled
          placeholder="Describe what you need — capacity, connectivity, constraints…"
          aria-label="Assistant input (not yet available)"
        />
        <IconButton disabled aria-label="Send" sx={{ mt: 0.25 }}>
          <SendIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box mt={1.5}>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {EXAMPLES.map(e => (
            <Chip key={e} size="small" variant="outlined" label={e} disabled />
          ))}
        </Stack>
      </Box>
    </Paper>
  );
}
