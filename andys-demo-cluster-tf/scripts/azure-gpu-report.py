#!/usr/bin/env python3
"""Join Azure SKU data with quota usage and report GPU VM availability.

Called by test-gpu-capacity-azure.sh. Takes the JSON output of
`az vm list-skus` and `az vm list-usage` so the whole report needs only
two API calls.

The SKU API exposes GPU *count* but not the GPU model or its VRAM, so those
come from the table below (sourced from the Microsoft Learn size-series
pages). Note that several NV sizes get a *fraction* of a physical GPU while
the API still reports "GPUs: 1" (e.g. Standard_NV6ads_A10_v5 is 1/6 of an
A10 with only 4 GB of VRAM). That distinction matters a lot when sizing model
serving, which is why GPU_SPECS records the real fraction and total VRAM.

Usage: azure-gpu-report.py <skus.json> <usage.json> <region> [--no-quota] [vm-size ...]

With --no-quota the usage file is ignored and only region-level availability
is reported, for when the answer is destined for a different subscription.
"""
import json
import sys

# SKU -> (GPU model, GPU qty as display string, total VRAM GB across the VM)
#
# WHY THIS IS A TABLE AND NOT AN API CALL
# ---------------------------------------
# Everything else in this script is read live from Azure. This is not, because
# Azure does not publish it. `az vm list-skus` returns ~28 capabilities for a
# GPU size and exactly one of them concerns the GPU:
#
#     GPUs    1
#
# A count. No model, no memory. Verified against the live API for
# Standard_NC40ads_H100_v5 on 2026-10-13. There is no other Azure endpoint that
# fills the gap - the Retail Prices API does not carry hardware detail either.
#
# A bare count is worse than useless for sizing model serving, because it is not
# even a count of whole GPUs: several NV sizes report "GPUs: 1" while giving a
# FRACTION of a physical card. Standard_NV6ads_A10_v5 reports 1 and is one sixth
# of an A10 with 4 GB of VRAM. Picking it to serve a 27B model on the strength
# of "1 GPU" would waste an afternoon.
#
# Figures from the Microsoft Learn "Accelerators" table for each size series.
# NVv2 and the NP FPGA sizes are derived from the per-card spec (M60 8 GB per
# exposed GPU, Alveo U250 64 GB per card); both are blocked in most regions.
#
# WHEN TO UPDATE
# --------------
# This WILL go stale: Azure adds GPU series faster than anyone updates a table.
# Refresh it when:
#   - the report prints "unknown" for a size you care about. That is the
#     designed signal - lookup falls back to ("unknown", <live count>, None)
#     rather than failing, so a missing entry degrades instead of breaking;
#   - a new accelerator series appears (H200, GB200, MI300X and successors);
#   - Microsoft re-specs an existing size, which does happen.
#
# To find sizes Azure offers here that this table does not know about:
#
#   az vm list-skus --location <region> --resource-type virtualMachines \
#     --query "[?capabilities[?name=='GPUs']].name" -o tsv | sort -u
#
# (slow - tens of seconds, it enumerates every size in the region) then
# cross-check each against its Microsoft Learn size-series page, which is the
# only authoritative source for model and VRAM:
#   https://learn.microsoft.com/azure/virtual-machines/sizes/overview
#
# Last reviewed 2026-10-13: the table covered all 37 GPU sizes Azure offers in
# westeurope, with nothing falling through to "unknown".
GPU_SPECS = {
    # NCads_H100_v5: NVIDIA H100 NVL, 94 GB per GPU
    "Standard_NC40ads_H100_v5":  ("H100 NVL",   "1",   94),
    "Standard_NC80adis_H100_v5": ("H100 NVL",   "2",   188),
    # NCCads_H100_v5: confidential computing, H100 NVL 94 GB
    "Standard_NCC40ads_H100_v5": ("H100 NVL*",  "1",   94),
    # NC_A100_v4: NVIDIA A100 PCIe, 80 GB per GPU
    "Standard_NC24ads_A100_v4":  ("A100 PCIe",  "1",   80),
    "Standard_NC48ads_A100_v4":  ("A100 PCIe",  "2",   160),
    "Standard_NC96ads_A100_v4":  ("A100 PCIe",  "4",   320),
    # NCasT4_v3: NVIDIA Tesla T4, 16 GB per GPU
    "Standard_NC4as_T4_v3":      ("Tesla T4",   "1",   16),
    "Standard_NC8as_T4_v3":      ("Tesla T4",   "1",   16),
    "Standard_NC16as_T4_v3":     ("Tesla T4",   "1",   16),
    "Standard_NC64as_T4_v3":     ("Tesla T4",   "4",   64),
    # NCv3: NVIDIA Tesla V100 PCIe, 16 GB per GPU (retired 2025-09-30)
    "Standard_NC6s_v3":          ("V100 PCIe",  "1",   16),
    "Standard_NC12s_v3":         ("V100 PCIe",  "2",   32),
    "Standard_NC24s_v3":         ("V100 PCIe",  "4",   64),
    "Standard_NC24rs_v3":        ("V100 PCIe",  "4",   64),
    # NVads_A10_v5: NVIDIA A10 24 GB, partitioned into fractional GPUs
    "Standard_NV6ads_A10_v5":    ("A10",        "1/6", 4),
    "Standard_NV12ads_A10_v5":   ("A10",        "1/3", 8),
    "Standard_NV18ads_A10_v5":   ("A10",        "1/2", 12),
    "Standard_NV36ads_A10_v5":   ("A10",        "1",   24),
    "Standard_NV36adms_A10_v5":  ("A10",        "1",   24),
    "Standard_NV72ads_A10_v5":   ("A10",        "2",   48),
    # NVv4: AMD Radeon Instinct MI25 16 GB, fractional (retired 2026-09-30)
    "Standard_NV4as_v4":         ("AMD MI25",   "1/8", 2),
    "Standard_NV8as_v4":         ("AMD MI25",   "1/4", 4),
    "Standard_NV16as_v4":        ("AMD MI25",   "1/2", 8),
    "Standard_NV32as_v4":        ("AMD MI25",   "1",   16),
    # NVv3: NVIDIA Tesla M60, 8 GB per exposed GPU (retired 2026-09-30)
    "Standard_NV12s_v3":         ("Tesla M60",  "1",   8),
    "Standard_NV24s_v3":         ("Tesla M60",  "2",   16),
    "Standard_NV48s_v3":         ("Tesla M60",  "4",   32),
    # NVv2: NVIDIA Tesla M60, 8 GB per exposed GPU
    "Standard_NV6s_v2":          ("Tesla M60",  "1",   8),
    "Standard_NV12s_v2":         ("Tesla M60",  "2",   16),
    "Standard_NV24s_v2":         ("Tesla M60",  "4",   32),
    # NDv2: NVIDIA V100 NVLink, 32 GB per GPU
    "Standard_ND40rs_v2":        ("V100 NVLink", "8",  256),
    # NDm_A100_v4: NVIDIA A100 SXM, 80 GB per GPU
    "Standard_ND96amsr_A100_v4": ("A100 SXM",   "8",   640),
    # NDasrA100_v4: NVIDIA A100 SXM, 40 GB per GPU
    "Standard_ND96asr_v4":       ("A100 SXM",   "8",   320),
    # ND_H100_v5: NVIDIA H100 SXM, 80 GB per GPU
    "Standard_ND96isr_H100_v5":  ("H100 SXM",   "8",   640),
    # NP: AMD/Xilinx Alveo U250 FPGA, 64 GB per card (retires 2027-05-31)
    "Standard_NP10s":            ("U250 FPGA",  "1",   64),
    "Standard_NP20s":            ("U250 FPGA",  "2",   128),
    "Standard_NP40s":            ("U250 FPGA",  "4",   256),
}


def norm(s):
    """Normalise a quota/SKU family name so the two sources can be matched.

    SKU families look like 'StandardNCadsH100v5Family' while quota entries
    look like 'Standard NCadsH100v5 Family vCPUs'.
    """
    s = "".join(c for c in s.lower() if c.isalnum())
    return s[:-5] if s.endswith("vcpus") else s


def main():
    skus_path, usage_path, region = sys.argv[1], sys.argv[2], sys.argv[3]
    rest = sys.argv[4:]
    show_quota = "--no-quota" not in rest
    wanted = {s.lower() for s in rest if s != "--no-quota"}

    skus = json.load(open(skus_path))

    quota = {}
    if show_quota:
        for u in json.load(open(usage_path)):
            quota[norm(u["localName"])] = (int(u["currentValue"]), int(u["limit"]))

    rows = []
    for s in skus:
        caps = {c["name"]: c["value"] for c in s.get("capabilities", [])}
        if not caps.get("GPUs"):
            continue
        name = s["name"]
        if wanted and name.lower() not in wanted:
            continue

        vcpus = int(caps.get("vCPUs", 0))
        ram = caps.get("MemoryGB", "?")
        model, qty, vram = GPU_SPECS.get(name, ("unknown", caps["GPUs"], None))

        zones = sorted({z for li in s.get("locationInfo", []) for z in li.get("zones", [])})
        restr = s.get("restrictions", [])
        blocked = any(r.get("type") == "Location" for r in restr)
        bad_zones = {z for r in restr if r.get("type") == "Zone"
                     for z in r.get("restrictionInfo", {}).get("zones", [])}
        free_zones = [z for z in zones if z not in bad_zones]
        reasons = sorted({r.get("reasonCode", "?") for r in restr})

        # Quota only matters once the SKU is actually offered to us.
        used, limit = quota.get(norm(s.get("family", "")), (None, None))
        if limit is None:
            headroom = None
        else:
            headroom = limit - used

        if blocked:
            status = "BLOCKED in region"
        elif not free_zones:
            status = "RESTRICTED " + (",".join(reasons) or "all zones")
        elif not show_quota:
            status = "OFFERED"
        elif limit == 0:
            status = "NO QUOTA — request increase"
        elif headroom is not None and vcpus and headroom < vcpus:
            status = "QUOTA FULL (%d/%d vCPU used)" % (used, limit)
        elif headroom is not None and vcpus:
            status = "AVAILABLE — room for %d node(s)" % (headroom // vcpus)
        else:
            status = "AVAILABLE"

        rows.append({
            "name": name, "model": model, "qty": qty, "vram": vram,
            "vcpus": vcpus, "ram": ram, "zones": free_zones or zones,
            "status": status,
            "ok": status.startswith("AVAILABLE") or status == "OFFERED",
            "vram_sort": vram or 0,
        })

    if not rows:
        print("No GPU SKUs matched in %s" % region)
        return

    rows.sort(key=lambda r: (not r["ok"], -r["vram_sort"], r["name"]))

    hdr = "%-28s %-12s %4s %7s %6s %7s  %-8s %s" % (
        "VM SIZE", "GPU", "QTY", "VRAM", "vCPU", "RAM", "ZONES", "STATUS")
    print("\nRegion: %s\n" % region)
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print("%-28s %-12s %4s %7s %6d %7s  %-8s %s" % (
            r["name"], r["model"], r["qty"],
            ("%d GB" % r["vram"]) if r["vram"] else "?",
            r["vcpus"], "%s GB" % r["ram"],
            ",".join(r["zones"]) or "-", r["status"]))

    usable = sum(1 for r in rows if r["ok"])
    if show_quota:
        print("\n%d GPU SKUs offered, %d deployable now (unrestricted + quota available)."
              % (len(rows), usable))
    else:
        print("\n%d GPU SKUs in region, %d unrestricted for this subscription. "
              "Quota not checked — it is per-subscription and most GPU families "
              "default to a limit of 0." % (len(rows), usable))
        if any("NotAvailableForSubscription" in r["status"] for r in rows):
            print("NotAvailableForSubscription is also per-subscription, so those "
                  "rows may be fine elsewhere. BLOCKED in region is not.")
    print("* NCC = confidential computing variant. "
          "Fractional QTY means a partitioned GPU — VRAM is what the VM actually sees.")


if __name__ == "__main__":
    main()
