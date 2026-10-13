import { describe, expect, it } from 'vitest';

import { toYaml, toYamlDocuments } from '../src/emit/yaml.js';

describe('toYaml', () => {
  it('writes nested maps', () => {
    expect(toYaml({ a: { b: { c: 1 } } })).toBe('a:\n  b:\n    c: 1');
  });

  it('writes sequences of scalars at the parent indentation', () => {
    expect(toYaml({ items: ['Ingress', 'Egress'] })).toBe('items:\n- Ingress\n- Egress');
  });

  it('writes sequences of maps', () => {
    expect(toYaml({ ports: [{ protocol: 'TCP', port: 443 }] })).toBe(
      'ports:\n- protocol: TCP\n  port: 443',
    );
  });

  it('nests a map inside a sequence inside a map', () => {
    const out = toYaml({ spec: { ingress: [{ from: [{ podSelector: {} }] }] } });
    expect(out).toBe('spec:\n  ingress:\n  - from:\n    - podSelector: {}');
  });

  it('renders empty collections inline', () => {
    expect(toYaml({ podSelector: {}, policyTypes: [] })).toBe(
      'podSelector: {}\npolicyTypes: []',
    );
  });

  it('drops undefined values rather than writing null', () => {
    expect(toYaml({ a: 1, b: undefined, c: 2 })).toBe('a: 1\nc: 2');
    expect(toYaml(['a', undefined, 'b'])).toBe('- a\n- b');
  });

  // Each of these is a string that an unquoted emitter would change the type of.
  it.each([
    ['4.22', "'4.22'"],
    ['yes', "'yes'"],
    ['No', "'No'"],
    ['y', "'y'"],
    ['n', "'n'"],
    ['off', "'off'"],
    ['true', "'true'"],
    ['null', "'null'"],
    ['', "''"],
    ['0755', "'0755'"],
    ['1e5', "'1e5'"],
    ['a: b', "'a: b'"],
    ['*star', "'*star'"],
    ['#hash', "'#hash'"],
    [' padded ', "' padded '"],
    ["it's", "'it''s'"],
  ])('quotes %j', (input, expected) => {
    expect(toYaml({ v: input })).toBe(`v: ${expected}`);
  });

  it.each(['westeurope', 'Standard_D16as_v5', 'app.kubernetes.io/name', '500m', 'TCP'])(
    'leaves %s unquoted',
    s => {
      expect(toYaml({ v: s })).toBe(`v: ${s}`);
    },
  );

  it('quotes keys that would otherwise change meaning', () => {
    expect(toYaml({ 'requests.cpu': '4', on: 1 })).toBe("requests.cpu: '4'\n'on': 1");
  });

  it('uses a literal block for multi-line strings', () => {
    expect(toYaml({ note: 'line one\nline two' })).toBe('note: |-\n  line one\n  line two');
  });

  it('indents a block scalar nested in a map', () => {
    expect(toYaml({ a: { note: 'x\ny' } })).toBe('a:\n  note: |-\n    x\n    y');
  });

  it('refuses to serialise a non-finite number', () => {
    expect(() => toYaml({ v: Number.NaN })).toThrow(/NaN/);
    expect(() => toYaml({ v: Number.POSITIVE_INFINITY })).toThrow(/Infinity/);
  });

  it('joins documents with a separator and a trailing newline', () => {
    expect(toYamlDocuments([{ a: 1 }, { b: 2 }])).toBe('a: 1\n---\nb: 2\n');
  });
});
