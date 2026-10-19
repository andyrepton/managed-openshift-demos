#!/usr/bin/env python3
"""Compose RHDH's dynamic-plugins ConfigMap from this demo plus any plugin demos.

RHDH takes exactly one dynamic-plugins ConfigMap, which pushed every demo's
plugin entries into this one file. That made the base demo undeployable alone:
the installer runs as an init container and raises on an image it cannot pull,
so a plugin someone had never built left Developer Hub stuck in Init:Error
rather than merely missing a page.

Each plugin demo now owns its entry and this stitches them together.

    python3 -I scripts/compose-dynamic-plugins.py                      # base only
    python3 -I scripts/compose-dynamic-plugins.py ../demo-x/rhdh/dynamic-plugins-entry.yaml
    python3 -I scripts/compose-dynamic-plugins.py ../demo-x/... --apply

With no entry files the output is byte-identical to
app-config/dynamic-plugins.yaml, so the base demo needs nothing extra.

Text concatenation rather than a YAML round-trip, deliberately: the comments
in these files carry most of their value - which trap each setting avoids -
and every YAML library in the standard library drops them.
"""

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent / 'app-config' / 'dynamic-plugins.yaml'

# Entry files carry a comment header, then `---`, then the list items at the
# indentation the ConfigMap's literal block needs.
SEPARATOR = '---\n'


def read_entry(path: Path) -> str:
    text = path.read_text()
    if SEPARATOR not in text:
        raise SystemExit(
            f"{path} has no '---' separator. An entry file is a comment header, "
            "then ---, then the list items at six spaces of indentation."
        )
    body = text.split(SEPARATOR, 1)[1].rstrip('\n')
    if not body.strip():
        raise SystemExit(f'{path} contains no plugin entries after the separator.')

    # A list item at the wrong depth silently lands outside `plugins:` and the
    # plugin is never installed, with nothing in the logs to say so.
    for line in body.splitlines():
        if line.strip().startswith('- ') and not line.startswith(' ' * 6):
            raise SystemExit(
                f'{path}: list items must be indented six spaces to sit under '
                f'`plugins:` inside the ConfigMap. Found:\n  {line!r}'
            )
    return body


def compose(entries: list[Path]) -> str:
    out = BASE.read_text().rstrip('\n')
    for path in entries:
        out += '\n\n' + read_entry(path)
    return out + '\n'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('entries', nargs='*', type=Path,
                    help='dynamic-plugins-entry.yaml files from plugin demos')
    ap.add_argument('--apply', action='store_true', help='oc apply the result')
    args = ap.parse_args()

    for path in args.entries:
        if not path.is_file():
            raise SystemExit(f'No such entry file: {path}')

    composed = compose(args.entries)

    if not args.apply:
        sys.stdout.write(composed)
        return 0

    proc = subprocess.run(['oc', 'apply', '-f', '-'], input=composed, text=True,
                          capture_output=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == '__main__':
    sys.exit(main())
