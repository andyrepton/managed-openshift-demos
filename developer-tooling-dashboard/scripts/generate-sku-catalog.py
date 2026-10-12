#!/usr/bin/env python3
"""
Generate the ARO supported-VM-size catalogue from Microsoft's support policy page.

Microsoft publishes the authoritative list of VM sizes ARO supports, with vCPU, RAM
and "day-2 only" flags, at:

    https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4

This is a better source than `az vm list-skus`: it needs no Azure credentials, and
more importantly it knows which sizes *ARO* supports, which is a much smaller set
than what Azure offers.

The source markdown lives in a private repo (MicrosoftDocs/azure-openshift-docs-pr),
so we parse the rendered HTML. That is inherently brittle, which is why the output is
committed to git and the runtime never calls this script. Regenerate deliberately:

    python3 -I scripts/generate-sku-catalog.py           # rewrite the JSON
    python3 -I scripts/generate-sku-catalog.py --check   # exit 1 if the page changed

Run the --check mode periodically (or in CI) to notice when Microsoft adds sizes.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import urllib.request

DOC_URL = "https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4"

PKG = pathlib.Path(__file__).resolve().parents[1] / "packages" / "aro-planner-common"
# The JSON is the canonical, diffable artefact that --check compares against.
OUTPUT = PKG / "data" / "sku-catalog.json"
# The TS module is what the code actually imports. Emitting a module rather than
# importing the JSON avoids import attributes and bundles cleanly for the browser.
OUTPUT_TS = PKG / "src" / "generated" / "sku-catalog.ts"

# The page writes these with inconsistent capitalisation between the control plane and
# worker sections ("General Purpose" vs "General purpose"), so normalise on the way in.
CATEGORIES = {
    "general purpose": "general-purpose",
    "memory optimized": "memory-optimized",
    "compute optimized": "compute-optimized",
    "memory and compute optimized": "memory-and-compute-optimized",
    "storage optimized": "storage-optimized",
    "gpu workload": "gpu",
}

# Minimum ARO version per series, stated in prose next to the tables rather than in a
# column, so it cannot be parsed out of the table itself. Kept here deliberately so it
# is reviewable; --check does not validate these.
MIN_VERSION = {
    "Dsv6": "4.19",
    "Ddsv6": "4.19",
    "Dlsv6": "4.19",
    "Dldsv6": "4.19",
    "Lsv4": "4.19",
    "FXmds_v2": "4.20",
    "ND_H100_v5": "4.19",
    "ND_H200_v5": "4.19",
    "NCads_H100_v5": "4.19",
    "NCCads_H100_v5": "4.19",
}


def strip_tags(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "aro-planner-sku-catalog/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def parse(html: str) -> list[dict]:
    """Walk the document in order, tracking the current node role and category."""
    rows: list[dict] = []

    # Tables appear under an h3 of "Control plane nodes" or "Worker nodes", each
    # immediately preceded by a category label.
    markers = []
    for m in re.finditer(r"<h3[^>]*>(.*?)</h3>|<table.*?</table>", html, re.S):
        markers.append(m)

    role = None
    for m in markers:
        chunk = m.group(0)
        if chunk.startswith("<h3"):
            heading = strip_tags(chunk).lower()
            if "control plane node" in heading:
                role = "control-plane"
            elif "worker node" in heading:
                role = "worker"
            continue

        if role is None:
            continue

        # The category label is the last text immediately before the table.
        preceding = strip_tags(html[max(0, m.start() - 400): m.start()])
        # Longest label first: "Memory and compute optimized" also ends with
        # "compute optimized", so a shortest-match would silently mislabel it.
        category = None
        for label in sorted(CATEGORIES, key=len, reverse=True):
            if preceding.lower().endswith(label):
                category = CATEGORIES[label]
                break
        if category is None:
            print(f"[WARN] could not identify category for a {role} table; skipping", file=sys.stderr)
            continue

        rows.extend(parse_table(chunk, role, category))

    return rows


def parse_table(table_html: str, role: str, category: str) -> list[dict]:
    out = []
    body = re.search(r"<tbody.*?</tbody>", table_html, re.S)
    if not body:
        return out

    for tr in re.findall(r"<tr.*?</tr>", body.group(0), re.S):
        cells = [strip_tags(td) for td in re.findall(r"<t[dh].*?</t[dh]>", tr, re.S)]
        if not cells:
            continue

        # Tables are either (Series, Size, vCPU, Memory) or (Size, vCPU, Memory).
        if len(cells) == 4:
            series_raw, name, vcpu, ram = cells
        elif len(cells) == 3:
            series_raw, (name, vcpu, ram) = "", cells
        else:
            continue

        if not name.startswith("Standard_"):
            continue

        # Footnote markers live in the series cell: `*` = day-2 only (not valid at
        # install time), `^` = day-2 only and gated on a newer ARO version.
        day2 = "*" in series_raw or "^" in series_raw or "*" in name or "^" in name
        series = series_raw.replace("*", "").replace("^", "").strip()
        name = name.replace("*", "").replace("^", "").strip()

        try:
            vcpu_i = int(re.sub(r"[^0-9]", "", vcpu))
            ram_f = float(re.sub(r"[^0-9.]", "", ram))
        except ValueError:
            print(f"[WARN] unparseable row: {cells}", file=sys.stderr)
            continue

        entry = {
            "name": name,
            "series": series,
            "vcpu": vcpu_i,
            "ramGiB": ram_f,
            "category": category,
            "role": role,
            "day2Only": day2,
        }
        if series in MIN_VERSION:
            entry["minVersion"] = MIN_VERSION[series]
        out.append(entry)

    return out


def build() -> dict:
    rows = parse(fetch(DOC_URL))
    if not rows:
        sys.exit("Parsed zero SKUs - the page layout has probably changed.")

    # Deduplicate on (name, role): a size can legitimately appear in both the control
    # plane and worker lists, but not twice within one.
    seen: dict[tuple[str, str], dict] = {}
    for r in rows:
        seen.setdefault((r["name"], r["role"]), r)
    skus = sorted(seen.values(), key=lambda r: (r["role"], r["category"], r["vcpu"], r["name"]))

    return {
        "_comment": (
            "Generated by scripts/generate-sku-catalog.py from Microsoft's ARO support "
            "policy page. Do not edit by hand - regenerate instead."
        ),
        "source": DOC_URL,
        "skuCount": len(skus),
        "skus": skus,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if the committed catalogue is out of date")
    args = ap.parse_args()

    fresh = build()

    if args.check:
        if not OUTPUT.exists():
            print(f"[FAIL] {OUTPUT} does not exist", file=sys.stderr)
            return 1
        current = json.loads(OUTPUT.read_text())
        if current.get("skus") == fresh["skus"]:
            print(f"[OK] catalogue is current ({fresh['skuCount']} SKUs)")
            return 0

        cur_names = {(s["role"], s["name"]) for s in current.get("skus", [])}
        new_names = {(s["role"], s["name"]) for s in fresh["skus"]}
        print("[FAIL] the published SKU list has changed.", file=sys.stderr)
        for item in sorted(new_names - cur_names):
            print(f"  + {item[0]}/{item[1]}", file=sys.stderr)
        for item in sorted(cur_names - new_names):
            print(f"  - {item[0]}/{item[1]}", file=sys.stderr)
        if cur_names == new_names:
            print("  (names unchanged - a vCPU/RAM/day2Only value differs)", file=sys.stderr)
        print("\nRun without --check to regenerate.", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fresh, indent=2) + "\n")
    print(f"[OK] wrote {fresh['skuCount']} SKUs to {OUTPUT}")

    OUTPUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_TS.write_text(render_ts(fresh))
    print(f"[OK] wrote {OUTPUT_TS}")
    return 0


def render_ts(data: dict) -> str:
    lines = [
        "/**",
        " * GENERATED FILE - DO NOT EDIT.",
        " *",
        " * Regenerate with: python3 -I scripts/generate-sku-catalog.py",
        f" * Source: {data['source']}",
        " */",
        "",
        "import type { Sku } from '../types.js';",
        "",
        f"export const SKU_CATALOG_SOURCE = {json.dumps(data['source'])};",
        "",
        "export const SKU_CATALOG: readonly Sku[] = [",
    ]
    for s in data["skus"]:
        parts = [
            f"name: {json.dumps(s['name'])}",
            f"series: {json.dumps(s['series'])}",
            f"vcpu: {s['vcpu']}",
            f"ramGiB: {s['ramGiB']:g}",
            f"category: {json.dumps(s['category'])}",
            f"role: {json.dumps(s['role'])}",
            f"day2Only: {'true' if s['day2Only'] else 'false'}",
        ]
        if "minVersion" in s:
            parts.append(f"minVersion: {json.dumps(s['minVersion'])}")
        lines.append("  { " + ", ".join(parts) + " },")
    lines += ["];", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
