import React, { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import type { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

import type { DeploymentModel, PlanResponse } from '../api/client';
import { Wizard } from '../components/Wizard';

/**
 * The value this field writes back into the Scaffolder form.
 *
 * Flattened deliberately: the template's later steps reference these with
 * `${{ parameters.plan.applicationName }}` and friends, so keeping it shallow
 * keeps the template readable.
 */
export interface AroClusterPlanValue {
  /** Becomes the namespace name and names every generated artifact. */
  applicationName: string;
  /** Which of the three models was chosen. Decides what the template emits. */
  deploymentModel: DeploymentModel;
  region: string;
  flavour: 'hcp' | 'classic';
  profile: string;
  vcpu: number;
  ramGiB: number;
  highAvailability: boolean;
  /** Absent for a shared namespace and for on-premises - neither builds a cluster. */
  nodePool?: {
    skuName: string;
    nodes: number;
    totalVcpu: number;
    totalRamGiB: number;
  };
  cost: {
    currency: string;
    /** Monthly for cloud, one-off where the model is billed that way. */
    billing: 'monthly' | 'one-off';
    amount: number;
    hourly: number;
    yearly: number;
    /**
     * False when no line came from the Azure Retail Prices API - i.e. the figure
     * is one of the demo multipliers. The template must not present it as a
     * price, which it cannot know unless this travels with the number.
     */
    metered: boolean;
    assumptions: string[];
  };
  /** Cluster networking and the generated policies, for the manifests step. */
  network: {
    apiVisibility: string;
    ingressVisibility: string;
    outboundType: string;
    policyNames: string[];
    /** Things NetworkPolicy cannot express. Must reach the reviewer. */
    caveats: string[];
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
      const model = plan?.request.deploymentModel ?? 'dedicated-cluster';
      // Cost the model the user actually chose. This previously always wrote
      // `plan.estimate`, which is the dedicated-cluster costing, so a namespace
      // request was published with a dedicated cluster's price on it.
      const chosen = plan?.comparison.find(c => c.model === model);

      if (!plan || !chosen?.estimate || chosen.amount === null) {
        onChange(undefined as unknown as AroClusterPlanValue);
        return;
      }

      const top = plan.recommendations[0];
      const needsCluster = model === 'dedicated-cluster';
      const net = plan.networkPlan;

      onChange({
        applicationName: plan.request.applicationName ?? '',
        deploymentModel: model,
        region: plan.request.region,
        flavour: plan.request.flavour,
        profile: plan.request.profile,
        vcpu: plan.request.vcpu,
        ramGiB: plan.request.ramGiB,
        highAvailability: plan.request.highAvailability,
        ...(needsCluster && top
          ? {
              nodePool: {
                skuName: top.sku.name,
                nodes: top.nodes,
                totalVcpu: top.totalVcpu,
                totalRamGiB: top.totalRamGiB,
              },
            }
          : {}),
        cost: {
          currency: chosen.estimate.currency,
          billing: chosen.billing,
          amount: chosen.amount,
          hourly: chosen.estimate.hourly,
          yearly: chosen.estimate.yearly,
          metered: chosen.estimate.lines.some(l => l.source === 'azure-api'),
          assumptions: chosen.estimate.assumptions,
        },
        network: {
          apiVisibility: net?.clusterSettings.apiVisibility ?? 'Private',
          ingressVisibility: net?.clusterSettings.ingressVisibility ?? 'Private',
          outboundType: net?.clusterSettings.outboundType ?? 'UserDefinedRouting',
          policyNames: (net?.policies ?? []).map(p => p.metadata.name),
          caveats: net?.caveats ?? [],
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
