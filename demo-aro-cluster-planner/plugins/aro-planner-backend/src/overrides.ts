import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PricingOverrides } from '@aro-planner/common';

/**
 * Pricing values Azure does not publish, supplied locally.
 *
 * Read from `config/pricing-overrides.json` at the repo root, or whatever
 * `ARO_PLANNER_OVERRIDES` points at. Absent file means no overrides, which is the
 * safe default: anything unpriced is excluded from the total and labelled, never
 * quietly treated as zero.
 */
export function loadOverrides(path?: string): Partial<PricingOverrides> {
  const file =
    path ??
    process.env.ARO_PLANNER_OVERRIDES ??
    resolve(process.cwd(), '../../config/pricing-overrides.json');

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const out: Partial<PricingOverrides> = {};

    if (typeof raw.hcpControlPlanePerHour === 'number') {
      out.hcpControlPlanePerHour = raw.hcpControlPlanePerHour;
    }
    if (typeof raw.hoursPerMonth === 'number') out.hoursPerMonth = raw.hoursPerMonth;
    if (typeof raw.osDiskGiB === 'number') out.osDiskGiB = raw.osDiskGiB;
    if (typeof raw.osDiskPerGiBMonth === 'number') out.osDiskPerGiBMonth = raw.osDiskPerGiBMonth;

    return out;
  } catch {
    return {};
  }
}
