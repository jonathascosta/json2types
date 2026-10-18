import { describe, expect, it } from 'vitest';
import { inferModel, parseJson } from '../infer';
import { generateTypeScript, propertyName, type TypeScriptOptions } from './typescript';

function typescript(json: string, options: TypeScriptOptions = {}, rootName?: string): string {
  return generateTypeScript(inferModel(parseJson(json), { rootName }), options);
}

const lines = (...text: string[]) => text.join('\n') + '\n';

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
        '  f: number;',
        '  b: boolean;',
        '  any: unknown[];',
        '  none: unknown;',
        '  empty: unknown[];',
        '}',
      ),
    );
  });

  it('says where integers go past ±2^53, which JSON.parse rounds', () => {
    const comment =
      '/** Integers here go past ±2^53 (Number.MAX_SAFE_INTEGER), so JSON.parse rounds some of them. */';
    expect(typescript('{"safe": 9007199254740991, "big": [1, 9007199254740993], "huge": 1e5}')).toBe(
      lines(
        'export interface Root {',
        '  safe: number;',
        `  ${comment}`,
        '  big: number[];',
        '  huge: number;',
        '}',
      ),
    );
    expect(typescript('[1, -9007199254740993]')).toBe(
      lines(comment, '// There are no types to declare: parse the JSON as number[].'),
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

  it('keeps JSON names, quoting those that are not identifiers', () => {
    const code = typescript(
      '{"class": 1, "$id": 2, "_x": 3, "a-b": 4, "1": 5, "𝑥": 6, "名前": 7, "": 8, "a b": 9}',
    );
    expect(code).toBe(
      lines(
        'export interface Root {',
        '  class: number;',
        '  $id: number;',
        '  _x: number;',
        '  "a-b": number;',
        '  "1": number;',
        '  𝑥: number;',
        '  名前: number;',
        '  "": number;',
        '  "a b": number;',
        '}',
      ),
    );
  });
});

describe('propertyName', () => {
  it.each([
    ['name', 'name'],
    ['delete', 'delete'],
    ['__proto__', '__proto__'],
    ['é', 'é'],
    ['a‍b', 'a‍b'],
    ['2fa', '"2fa"'],
    ['a.b', '"a.b"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['back\\slash', '"back\\\\slash"'],
    ['tab\there', '"tab\\there"'],
    [' ', '"\\u2028"'],
    ['a‮b', '"a\\u202Eb"'],
    ['﻿', '"\\uFEFF"'],
    ['\uD800', '"\\ud800"'],
  ])('%j → %s', (name, expected) => {
    expect(propertyName(name)).toBe(expected);
  });
});
