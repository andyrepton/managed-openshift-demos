/**
 * A small YAML writer for the manifests this package emits.
 *
 * Written rather than depended on because `@aro-planner/common` has no runtime
 * dependencies and is embedded wholesale into the RHDH dynamic plugin - adding
 * `js-yaml` would pull it into the frontend bundle for the sake of a few hundred
 * lines of output we fully control the shape of.
 *
 * It handles exactly what Kubernetes manifests need: maps, sequences, scalars and
 * block strings. It is NOT a general YAML emitter - no anchors, no tags, no flow
 * collections beyond empty ones. The quoting rule is deliberately pessimistic: a
 * string is quoted unless it is obviously safe unquoted, because emitting
 * `version: 4.22` where a string was meant changes the type and the error surfaces
 * much later, in the API server.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | YamlValue[]
  | { [key: string]: YamlValue };

/**
 * Plain scalars we allow unquoted: starts alphanumeric, contains only characters
 * with no structural meaning in YAML. Everything else is quoted.
 */
const PLAIN_SAFE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;

/** Anything YAML 1.1 readers coerce to a boolean or null. */
const RESERVED = new Set([
  'y', 'n', 'yes', 'no', 'true', 'false', 'on', 'off', 'null', '~',
]);

/** Looks like a number, so would stop being a string on the way back in. */
const NUMERIC = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

function needsQuoting(s: string): boolean {
  if (s === '') return true;
  if (!PLAIN_SAFE.test(s)) return true;
  if (s !== s.trim()) return true;
  if (RESERVED.has(s.toLowerCase())) return true;
  if (NUMERIC.test(s)) return true;
  return false;
}

/**
 * Render a string scalar.
 *
 * Multi-line strings become literal block scalars. `-` strips the trailing
 * newline, so a caveat round-trips as exactly the text given.
 */
function scalar(s: string, indent: string): string {
  if (s.includes('\n')) {
    const lines = s.replace(/\n+$/, '').split('\n');
    return ['|-', ...lines.map(l => `${indent}  ${l}`)].join('\n');
  }
  if (needsQuoting(s)) return `'${s.replace(/'/g, "''")}'`;
  return s;
}

function isRecord(v: YamlValue): v is { [key: string]: YamlValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when a value renders on the same line as its key. */
function isInline(v: YamlValue): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (isRecord(v)) return Object.keys(v).length === 0;
  return true;
}

function inline(v: YamlValue, indent: string): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`cannot serialise ${v} to YAML`);
    return String(v);
  }
  if (typeof v === 'string') return scalar(v, indent);
  return Array.isArray(v) ? '[]' : '{}';
}

/**
 * Serialise a value to YAML.
 *
 * `undefined` entries are dropped rather than written as `null`, so callers can
 * build manifests with conditional fields without littering the output with
 * explicit nulls - which Kubernetes treats differently from an absent field.
 */
export function toYaml(value: YamlValue, indent = ''): string {
  if (!isRecord(value) && !Array.isArray(value)) return inline(value, indent);
  if (isInline(value)) return inline(value, indent);

  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => {
        if (isInline(item)) return `${indent}- ${inline(item, indent)}`;
        // A nested collection starts on the dash line, so its first key is
        // indented by the two characters the dash occupies.
        const body = toYaml(item, `${indent}  `);
        return `${indent}- ${body.slice(indent.length + 2)}`;
      })
      .join('\n');
  }

  return Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const key = needsQuoting(k) ? `'${k.replace(/'/g, "''")}'` : k;
      if (isInline(v)) return `${indent}${key}: ${inline(v, indent)}`;
      // Sequences sit at the parent's indentation; maps nest one level in.
      const childIndent = Array.isArray(v) ? indent : `${indent}  `;
      return `${indent}${key}:\n${toYaml(v, childIndent)}`;
    })
    .join('\n');
}

/** One or more manifests as a single multi-document YAML file. */
export function toYamlDocuments(docs: YamlValue[]): string {
  return `${docs.map(d => toYaml(d)).join('\n---\n')}\n`;
}
