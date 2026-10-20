import { describe, expect, it } from 'vitest';

import {
  computeSizing,
  EDITOR_CPU_MILLI,
  EDITOR_RAM_MIB,
  MAX_WORKSPACES,
  MIN_WORKSPACE_CPU_MILLI,
  MIN_WORKSPACE_RAM_MIB,
  SizingError,
  type SizingInput,
} from '../src/sizing';

const base: SizingInput = {
  workspaceCount: 2,
  totalVcpu: 4,
  totalRamGiB: 8,
  storageGiB: 10,
  storageMode: 'persistent',
};

describe('computeSizing', () => {
  it('divides the total across the workspaces asked for', () => {
    const s = computeSizing(base);
    expect(s.perWorkspace.cpuLimitMilli).toBe(2000);
    expect(s.perWorkspace.ramLimitMiB).toBe(4096);
  });

  it('leaves room for the editor, which the controller adds to the container', () => {
    // The bug this guards: the devfile asked for the full per-workspace
    // figure, the controller merged che-code's 500m/1024Mi in on top, and the
    // namespace's own LimitRange rejected the pod:
    //   maximum memory usage per Container is 4Gi, but limit is 5Gi
    const s = computeSizing(base);
    expect(s.workload.cpuLimitMilli + EDITOR_CPU_MILLI).toBe(s.perWorkspace.cpuLimitMilli);
    expect(s.workload.ramLimitMiB + EDITOR_RAM_MIB).toBe(s.perWorkspace.ramLimitMiB);
  });

  it('keeps the merged container inside the LimitRange maximum', () => {
    const s = computeSizing(base);
    // LimitRange max is perWorkspace; merged container is workload + editor.
    expect(s.workload.cpuLimitMilli + EDITOR_CPU_MILLI).toBeLessThanOrEqual(
      s.perWorkspace.cpuLimitMilli,
    );
    expect(s.workload.ramLimitMiB + EDITOR_RAM_MIB).toBeLessThanOrEqual(
      s.perWorkspace.ramLimitMiB,
    );
  });

  it('never leaves the workload with nothing', () => {
    const s = computeSizing({ ...base, workspaceCount: 1, totalVcpu: 1, totalRamGiB: 2 });
    expect(s.workload.cpuLimitMilli).toBeGreaterThan(0);
    expect(s.workload.ramLimitMiB).toBeGreaterThan(0);
  });

  it('requests less than it limits, so idle workspaces do not hold a whole node', () => {
    const s = computeSizing(base);
    expect(s.perWorkspace.cpuRequestMilli).toBeLessThan(s.perWorkspace.cpuLimitMilli);
    expect(s.perWorkspace.ramRequestMiB).toBeLessThan(s.perWorkspace.ramLimitMiB);
  });

  it('caps the quota at what was actually asked for', () => {
    const s = computeSizing(base);
    expect(s.quota.limitsCpuMilli).toBe(4000);
    expect(s.quota.limitsRamMiB).toBe(8192);
  });

  it('leaves pod headroom, because a restart runs two pods briefly', () => {
    expect(computeSizing(base).quota.pods).toBe(base.workspaceCount + 1);
  });

  it('refuses a split too small to run the editor, with a reason', () => {
    // 1 vCPU over 4 workspaces is 250m each; che-code alone needs 500m.
    expect(() => computeSizing({ ...base, workspaceCount: 4, totalVcpu: 1 })).toThrow(
      SizingError,
    );
  });

  it('refuses memory too small to run the editor', () => {
    expect(() => computeSizing({ ...base, workspaceCount: 8, totalRamGiB: 8 })).toThrow(
      SizingError,
    );
  });

  it('names BOTH shortfalls at once, not whichever is checked first', () => {
    // The bug this guards: reporting CPU first meant raising vCPU made the
    // message switch to memory, which reads as the same error refusing to
    // clear. Someone raised vCPU to 64 against a memory limit no amount of
    // vCPU could satisfy.
    try {
      computeSizing({ ...base, workspaceCount: 4, totalVcpu: 1, totalRamGiB: 4 });
      throw new Error('should have thrown');
    } catch (err) {
      const m = (err as Error).message;
      expect(m).toMatch(/vCPU/);
      expect(m).toMatch(/memory/);
    }
  });

  it('states the minimum totals needed, so the fix is one read away', () => {
    try {
      computeSizing({ ...base, workspaceCount: 4, totalVcpu: 64, totalRamGiB: 4 });
      throw new Error('should have thrown');
    } catch (err) {
      const m = (err as Error).message;
      // 4 workspaces x (editor 500m + floor 500m) = 4 vCPU,
      // and 4 x (1024Mi + 1024Mi) = 8 GiB.
      expect(m).toMatch(/at least 4 vCPU and 8 GiB in total/);
      expect(m).toMatch(/You asked for 64 vCPU and 4 GiB/);
    }
  });

  it('does not mention vCPU when only memory is short', () => {
    try {
      computeSizing({ ...base, workspaceCount: 4, totalVcpu: 64, totalRamGiB: 4 });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toMatch(/of vCPU each|m of vCPU/);
    }
  });

  it('accepts exactly the minimum', () => {
    const s = computeSizing({
      ...base,
      workspaceCount: 1,
      totalVcpu: MIN_WORKSPACE_CPU_MILLI / 1000,
      totalRamGiB: MIN_WORKSPACE_RAM_MIB / 1024,
    });
    expect(s.perWorkspace.cpuLimitMilli).toBe(MIN_WORKSPACE_CPU_MILLI);
    expect(s.workload.cpuLimitMilli).toBe(MIN_WORKSPACE_CPU_MILLI - EDITOR_CPU_MILLI);
  });

  it('rejects nonsense counts rather than producing a strange quota', () => {
    expect(() => computeSizing({ ...base, workspaceCount: 0 })).toThrow(SizingError);
    expect(() => computeSizing({ ...base, workspaceCount: 1.5 })).toThrow(SizingError);
    expect(() => computeSizing({ ...base, workspaceCount: MAX_WORKSPACES + 1 })).toThrow(
      SizingError,
    );
    expect(() => computeSizing({ ...base, totalVcpu: 0 })).toThrow(SizingError);
  });

  it('needs a storage size when storage is persistent', () => {
    expect(() => computeSizing({ ...base, storageGiB: 0 })).toThrow(/storageGiB/);
  });

  it('asks for no PVCs at all when ephemeral, rather than a quota of zero', () => {
    // A hard limit of 0 PVCs rejects the workspace; omitting the key does not.
    const s = computeSizing({ ...base, storageMode: 'ephemeral', storageGiB: 0 });
    expect(s.quota.persistentVolumeClaims).toBe(0);
    expect(s.quota.requestsStorageGiB).toBe(0);
    expect(s.warnings.join(' ')).toMatch(/lost when the workspace stops/);
  });

  it('warns when the editor leaves almost nothing for the workload', () => {
    const s = computeSizing({ ...base, workspaceCount: 1, totalVcpu: 1, totalRamGiB: 2 });
    expect(s.warnings.join(' ')).toMatch(/che-code takes/);
  });

  it('warns that the cluster-wide running-workspace limit can still win', () => {
    const s = computeSizing({ ...base, workspaceCount: 3, totalVcpu: 6, totalRamGiB: 12 });
    expect(s.warnings.join(' ')).toMatch(/maxNumberOfRunningWorkspacesPerUser/);
  });
});
