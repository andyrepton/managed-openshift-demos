import React, { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import type { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

import type { PlanResponse } from '../api/client';
import { Wizard } from '../components/Wizard';

/**
 * The value this field writes back into the Scaffolder form.
 *
 * Flattened deliberately: the template's later steps reference these with
 * `${{ parameters.plan.clusterName }}` and friends, so keeping it shallow keeps the
 * template readable.
 */
export interface AroClusterPlanValue {
  region: string;
  flavour: 'hcp' | 'classic';
  profile: string;
  vcpu: number;
  ramGiB: number;
  highAvailability: boolean;
  nodePool: {
    skuName: string;
    nodes: number;
    totalVcpu: number;
    totalRamGiB: number;
  };
  cost: {
    currency: string;
    hourly: number;
    monthly: number;
    yearly: number;
    assumptions: string[];
  };
}

/**
 * The entire wizard bound to a single object-typed parameter.
 *
 * One field rather than many on purpose. Backstage discourages reading sibling
 * fields via `formContext.formData`, and it misbehaves in `scaffolder/next` (the
 * version RHDH ships) - see backstage/backstage#15830. Keeping all state inside one
 * component sidesteps that entirely.
 */
export function AroClusterPlannerField(
  props: FieldExtensionComponentProps<AroClusterPlanValue>,
) {
  const { onChange, rawErrors, required, formData } = props;

  const handlePlan = useCallback(
    (plan: PlanResponse | null) => {
      if (!plan?.estimate || plan.recommendations.length === 0) {
        onChange(undefined as unknown as AroClusterPlanValue);
        return;
      }
      const top = plan.recommendations[0]!;
      onChange({
        region: plan.request.region,
        flavour: plan.request.flavour,
        profile: plan.request.profile,
        vcpu: plan.request.vcpu,
        ramGiB: plan.request.ramGiB,
        highAvailability: plan.request.highAvailability,
        nodePool: {
          skuName: top.sku.name,
          nodes: top.nodes,
          totalVcpu: top.totalVcpu,
          totalRamGiB: top.totalRamGiB,
        },
        cost: {
          currency: plan.estimate.currency,
          hourly: plan.estimate.hourly,
          monthly: plan.estimate.monthly,
          yearly: plan.estimate.yearly,
          assumptions: plan.estimate.assumptions,
        },
      });
    },
    [onChange],
  );

  const hasError = Boolean(rawErrors?.length) && !formData;

  return (
    <Box>
      <Wizard onPlanChange={handlePlan} />
      {hasError && (
        <FormHelperText error>
          Choose a configuration that can be priced before continuing.
        </FormHelperText>
      )}
      {required && !formData && !hasError && (
        <Typography variant="caption" color="text.secondary">
          A priced configuration is required before you can continue.
        </Typography>
      )}
    </Box>
  );
}
