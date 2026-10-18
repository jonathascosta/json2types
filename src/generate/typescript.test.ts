import { describe, expect, it } from 'vitest';
import { inferModel, parseJson } from '../infer';
import { generateTypeScript, propertyName, type TypeScriptOptions } from './typescript';

function typescript(json: string, options: TypeScriptOptions = {}, rootName?: string): string {
  return generateTypeScript(inferModel(parseJson(json), { rootName }), options);
}

const lines = (...text: string[]) => text.join('\n') + '\n';

const UNSAFE =
  'Some numbers here are beyond ±2^53, where JSON.parse may lose digits: to keep them exact, send them as strings or use a JSON parser that keeps big numbers.';

const SAMPLE =
  '[{"id": 7, "first-name": "Ana", "tags": ["a", null], "address": {"city": "Porto"}}, {"id": 8, "first-name": null, "tags": []}]';

describe('generateTypeScript', () => {
  it('writes exported interfaces by default, with optional and nullable members', () => {
    expect(typescript(SAMPLE)).toBe(
      lines(
        '// Parse the JSON as Root[].',
        '',
        'export interface Root {',
        '  id: number;',
        '  "first-name": string | null;',
        '  tags: (string | null)[];',
        '  address?: Address;',
        '}',
        '',
        'export interface Address {',
        '  city: string;',
        '}',
      ),
    );
  });

  it('writes type aliases', () => {
    expect(typescript('{"a": true}', { declaration: 'type' })).toBe(
      lines('export type Root = {', '  a: boolean;', '};'),
    );
  });

  it('stays a module without export, so no type merges with a global', () => {
    expect(typescript('{"a": true}', { export: false })).toBe(
      lines('interface Root {', '  a: boolean;', '}', '', 'export {};'),
    );
    expect(typescript('{"a": true}', { export: false, declaration: 'type' })).toBe(
      lines('type Root = {', '  a: boolean;', '};', '', 'export {};'),
    );
  });

  it('marks members and arrays readonly', () => {
    expect(typescript('{"a": [[1], null], "b": [{"c": "x"}]}', { readonly: true })).toBe(
      lines(
        'export interface Root {',
        '  readonly a: readonly (readonly number[] | null)[];',
        '  readonly b: readonly BItem[];',
        '}',
        '',
        'export interface BItem {',
        '  readonly c: string;',
        '}',
      ),
    );
  });

  it('names the root type as inferModel was told', () => {
    expect(typescript('{"a": true}', {}, 'order line')).toContain('export interface OrderLine {\n');
  });

  it('maps every inferred type', () => {
    const json = `{
      "s": "x", "when": "2026-10-18T12:00:00Z", "day": "2026-10-18",
      "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "i": 1, "l": 3000000000,
      "d": 1.5, "f": 1e300, "b": false, "any": [1, "x"], "none": null, "empty": []
    }`;
    expect(typescript(json)).toBe(
      lines(
        'export interface Root {',
        '  s: string;',
        '  when: string;',
        '  day: string;',
        '  id: string;',
        '  i: number;',
        '  l: number;',
        '  d: number;',
        `  /** ${UNSAFE} */`,
        '  f: number;',
        '  b: boolean;',
        '  any: unknown[];',
        '  none: unknown;',
        '  empty: unknown[];',
        '}',
      ),
    );
  });

  it('says where numbers go past ±2^53, where JSON.parse may lose digits', () => {
    const comment = `/** ${UNSAFE} */`;
    expect(
      typescript(
        '{"safe": 9007199254740991, "big": [1, 9007199254740993], "mixed": [0.5, 1e20], "small": 1e5}',
      ),
    ).toBe(
      lines(
        'export interface Root {',
        '  safe: number;',
        `  ${comment}`,
        '  big: number[];',
        `  ${comment}`,
        '  mixed: number[];',
        '  small: number;',
        '}',
      ),
    );
    expect(typescript('[1, -9007199254740993]')).toBe(
      lines(`// ${UNSAFE}`, '// There are no types to declare: parse the JSON as number[].'),
    );
  });

  it('writes an object that was always empty as a record of nothing', () => {
    expect(typescript('{"meta": {}}', { declaration: 'interface' })).toBe(
      lines('export interface Root {', '  meta: Meta;', '}', '', 'export type Meta = Record<string, never>;'),
    );
  });

  it('says what to parse a root that is not an object as', () => {
    expect(typescript('[{"a": 1}, null]')).toContain('// Parse the JSON as (Root | null)[].\n');
    expect(typescript('[1, 2]', { export: false })).toBe(
      '// There are no types to declare: parse the JSON as number[].\n',
    );
    expect(typescript('null')).toBe('// There are no types to declare: parse the JSON as unknown.\n');
    expect(typescript('[[1, null]]', { readonly: true })).toBe(
      '// There are no types to declare: parse the JSON as readonly (readonly (number | null)[])[].\n',
    );
  });

  it('keeps JSON names, quoting those that are not plain ASCII identifiers', () => {
    const code = typescript(
      '{"class": 1, "$id": 2, "_x": 3, "a-b": 4, "1": 5, "\\ud835\\udc65": 6, "\\u540d": 7, "": 8, "a b": 9}',
    );
    expect(code).toBe(
      lines(
        'export interface Root {',
        '  class: number;',
        '  $id: number;',
        '  _x: number;',
        '  "a-b": number;',
        '  "1": number;',
        '  "\u{1D465}": number;',
        '  "\u540D": number;',
        '  "": number;',
        '  "a b": number;',
        '}',
      ),
    );
  });

  it('writes full declarations with every option off its default', () => {
    expect(
      typescript('{"a": [1], "b": {"c": null}}', { declaration: 'type', export: false, readonly: true }),
    ).toBe(
      lines(
        'type Root = {',
        '  readonly a: readonly number[];',
        '  readonly b: B;',
        '};',
        '',
        'type B = {',
        '  readonly c: unknown;',
        '};',
        '',
        'export {};',
      ),
    );
  });
});

describe('propertyName', () => {
  it.each([
    ['name', 'name'],
    ['delete', 'delete'],
    ['__proto__', '__proto__'],
    ['A1_$', 'A1_$'],
    // Letters beyond ASCII are quoted: TypeScript's Unicode tables can be older than the browser's.
    ['\u00e9', '"\u00e9"'],
    ['\u2C64', '"\u2C64"'],
    ['\u{1D465}', '"\u{1D465}"'],
    ['2fa', '"2fa"'],
    ['a.b', '"a.b"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['back\\slash', '"back\\\\slash"'],
    ['tab\there', '"tab\\there"'],
    // What can't be seen is escaped, both halves of a surrogate pair included.
    ['a\u200Db', '"a\\u200db"'],
    ['\u2028', '"\\u2028"'],
    ['a\u202Eb', '"a\\u202eb"'],
    ['\uFEFF', '"\\ufeff"'],
    ['a\u00A0b', '"a\\u00a0b"'],
    ['\u3164', '"\\u3164"'],
    ['a\u{E0041}b', '"a\\udb40\\udc41b"'],
    ['\uD800', '"\\ud800"'],
    // C1 controls, variation selectors, the grapheme joiner and the braille blank, which
    // JSON.stringify leaves as they are.
    ['a\u0085b\u007F', '"a\\u0085b\\u007f"'],
    ['a\uFE0Fb\u{E0100}', '"a\\ufe0fb\\udb40\\udd00"'],
    ['a\u034Fb\u2800', '"a\\u034fb\\u2800"'],
  ])('%j → %s', (name, expected) => {
    expect(propertyName(name)).toBe(expected);
  });
});
