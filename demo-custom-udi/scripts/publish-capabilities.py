#!/usr/bin/env python3
"""Publish what the built image contains, as a ConfigMap.

A self-service form must not invent its options. Offering Kilo when the image
does not carry it produces a workspace whose DEFAULT_EXTENSIONS points at a
file that is not there, and che-code logs a failure nobody reads.

So the image build publishes its own contents, and the form reads them:

    python3 -I scripts/publish-capabilities.py            # print the ConfigMap
    python3 -I scripts/publish-capabilities.py --apply    # oc apply it

The image reference defaults to the ImageStream the BuildConfig writes to.
Override with --image when publishing a different build.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE.parent / 'extensions.json'

DEFAULT_IMAGE = (
    'image-registry.openshift-image-registry.svc:5000/custom-udi/custom-udi:latest'
)
NAMESPACE = 'custom-udi'
NAME = 'udi-capabilities'


def build_configmap(image: str) -> dict:
    manifest = json.loads(MANIFEST.read_text())

    # Only what a consumer needs: what is in the image, where, and which
    # version. The notes and sha256 are for whoever maintains the image and
    # would only be noise in a form.
    payload = {
        'image': image,
        'extensionDir': manifest['extensionDir'],
        'tools': [
            {
                k: t[k]
                for k in ('id', 'kind', 'displayName', 'description', 'version', 'file', 'binary')
                if k in t
            }
            for t in manifest['tools']
        ],
    }

    return {
        'apiVersion': 'v1',
        'kind': 'ConfigMap',
        'metadata': {
            'name': NAME,
            'namespace': NAMESPACE,
            'labels': {'app.kubernetes.io/managed-by': 'custom-udi'},
            'annotations': {
                'custom-udi/generated-by': 'scripts/publish-capabilities.py',
                'custom-udi/source': 'extensions.json',
            },
        },
        'data': {'capabilities.json': json.dumps(payload, indent=2) + '\n'},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--image', default=DEFAULT_IMAGE, help='image reference to publish')
    ap.add_argument('--apply', action='store_true', help='oc apply instead of printing')
    args = ap.parse_args()

    cm = build_configmap(args.image)
    body = json.dumps(cm, indent=2)

    if not args.apply:
        print(body)
        return 0

    # JSON is valid YAML, so this needs no YAML library and cannot be tripped
    # up by quoting.
    proc = subprocess.run(
        ['oc', 'apply', '-f', '-'], input=body, text=True, capture_output=True
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == '__main__':
    sys.exit(main())
