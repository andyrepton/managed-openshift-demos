import type { PriceTable } from '../src/types.js';

/**
 * Real values pulled from the Azure Retail Prices API for westeurope on 2026-10-12.
 *
 * Recorded rather than fetched so the cost tests are deterministic and run offline.
 * Refresh with `node --experimental-strip-types scripts/refresh-price-fixture.ts`
 * if Azure's published rates move.
 */
export const WESTEUROPE_PRICES: PriceTable = {
  currency: 'USD',
  region: 'westeurope',
  vm: {
    Standard_D4s_v5: 0.23,
    Standard_D8s_v5: 0.46,
    Standard_D16s_v5: 0.92,
    Standard_D32s_v5: 1.84,
    Standard_E8s_v5: 0.604,
    Standard_E16s_v5: 1.208,
    Standard_E32s_v5: 2.416,
    Standard_F8s_v2: 0.4049,
    Standard_F16s_v2: 0.8098,
  },
  aroLicence: {
    // `<productName>|<vcpu>`
    'Azure Red Hat OpenShift General Purpose|4': 0.171,
    'Azure Red Hat OpenShift General Purpose|8': 0.342,
    'Azure Red Hat OpenShift General Purpose|16': 0.684,
    'Azure Red Hat OpenShift General Purpose|32': 1.368,
    'Azure Red Hat OpenShift Memory Optimized|8': 0.342,
    'Azure Red Hat OpenShift Memory Optimized|16': 0.684,
    'Azure Red Hat OpenShift Memory Optimized|32': 1.368,
    'Azure Red Hat OpenShift Compute Optimized|8': 0.342,
    'Azure Red Hat OpenShift Compute Optimized|16': 0.684,
  },
  aroLicencePerVcpu: 0.0428,
  retrievedAt: '2026-10-12T00:00:00.000Z',
};
