import type { PriceTable } from '@aro-planner/common';

/**
 * A fixed price table, so the tests never reach Azure.
 *
 * Figures are realistic westeurope on-demand rates rather than round numbers,
 * because a cost model is easy to get accidentally right against 1.00.
 */
export const WESTEUROPE_PRICES: PriceTable = {
  currency: 'USD',
  region: 'westeurope',
  vm: {
    Standard_D8s_v5: 0.46,
    Standard_D16s_v5: 0.92,
    Standard_D32s_v5: 1.84,
    Standard_D16as_v5: 0.832,
    Standard_D8s_v3: 0.464,
    Standard_E16s_v5: 1.208,
    Standard_E32s_v5: 2.416,
  },
  aroLicence: {
    'Azure Red Hat OpenShift General Purpose|8': 0.342,
    'Azure Red Hat OpenShift General Purpose|16': 0.684,
    'Azure Red Hat OpenShift General Purpose|32': 1.368,
    'Azure Red Hat OpenShift Memory Optimized|16': 0.684,
    'Azure Red Hat OpenShift Memory Optimized|32': 1.368,
  },
  aroLicencePerVcpu: 0.0428,
  retrievedAt: '2026-10-12T00:00:00.000Z',
};
