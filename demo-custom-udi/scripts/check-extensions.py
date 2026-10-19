#!/usr/bin/env python3
"""Check the pinned tooling in extensions.json against upstream.

Pinning versions is what makes the image reproducible; the cost is that
nothing tells you when a pin goes stale. This does.

    python3 -I scripts/check-extensions.py            # report
    python3 -I scripts/check-extensions.py --check    # exit 1 if anything moved

It never edits the manifest. Bumping a version means changing the version AND
the sha256 together, and a script that rewrote both from whatever upstream
served today would defeat the point of pinning them.

Run with -I. This reads untrusted network data, and -I keeps the interpreter
from loading anything out of the working directory.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent.parent / 'extensions.json'
TIMEOUT = 30


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return json.load(res)


def latest_open_vsx(spec: dict) -> str | None:
    """Newest version on open-vsx for a namespace/name[/target]."""
    url = f"https://open-vsx.org/api/{spec['namespace']}/{spec['name']}"
    if target := spec.get('target'):
        url += f'/{target}'
    try:
        return fetch_json(url).get('version')
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
        print(f'  ! could not reach open-vsx: {err}', file=sys.stderr)
        return None


def latest_github(spec: dict) -> str | None:
    """Newest release tag, with any leading v stripped to match the manifest."""
    url = f"https://api.github.com/repos/{spec['repo']}/releases/latest"
    try:
        tag = fetch_json(url).get('tag_name', '')
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
        print(f'  ! could not reach GitHub: {err}', file=sys.stderr)
        return None
    return tag[1:] if tag.startswith('v') else tag


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true',
                    help='exit 1 if any pin is behind upstream')
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    stale, unknown = [], []

    for tool in manifest['tools']:
        pinned = tool['version']
        if 'openVsx' in tool:
            latest = latest_open_vsx(tool['openVsx'])
        elif 'github' in tool:
            latest = latest_github(tool['github'])
        else:
            latest = None

        if latest is None:
            unknown.append(tool['id'])
            status = 'unknown'
        elif latest == pinned:
            status = 'current'
        else:
            stale.append((tool['id'], pinned, latest))
            status = f'STALE -> {latest}'

        print(f"{tool['id']:<22} {pinned:<12} {status}")

    if stale:
        print('\nBehind upstream:')
        for tool_id, pinned, latest in stale:
            print(f'  {tool_id}: {pinned} -> {latest}')
        print('\nTo bump one, change BOTH the version and the sha256 in '
              'extensions.json, then rebuild. Download the new file and hash it:')
        print('  curl -fsSL <url> -o /tmp/x && sha256sum /tmp/x')

    # An unreachable registry is not the same as a stale pin, and a CI job that
    # fails the build because open-vsx had a bad minute teaches people to
    # ignore it.
    if unknown:
        print(f"\nCould not check: {', '.join(unknown)}", file=sys.stderr)

    return 1 if (args.check and stale) else 0


if __name__ == '__main__':
    sys.exit(main())
