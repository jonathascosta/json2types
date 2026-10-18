import { describe, expect, it } from 'vitest';
import { inferModel, type InferOptions } from './infer';
import type { Model } from './model';
import { parseJson } from './parse';

const infer = (json: string, options?: InferOptions): Model => inferModel(parseJson(json), options);
const declaration = (model: Model, name: string) => model.declarations.find((d) => d.name === name);
const property = (model: Model, type: string, jsonName: string) =>
  declaration(model, type)?.properties.find((p) => p.jsonName === jsonName);

describe('inferModel', () => {
  it('describes every kind of value, nested to any depth', () => {
    const model = infer(
      '{"name":"Ana","age":30,"score":9.5,"active":true,"address":{"city":"Porto","geo":{"lat":41.1}}}',
    );
    expect(model.root).toEqual({ type: { kind: 'object', name: 'Root' }, nullable: false });
    expect(model.declarations.map((d) => d.name)).toEqual(['Root', 'Address', 'Geo']);
    expect(declaration(model, 'Root')?.properties).toEqual([
      { jsonName: 'name', type: { kind: 'string' }, nullable: false, optional: false },
      { jsonName: 'age', type: { kind: 'integer', bits: 32 }, nullable: false, optional: false },
      { jsonName: 'score', type: { kind: 'decimal' }, nullable: false, optional: false },
      { jsonName: 'active', type: { kind: 'boolean' }, nullable: false, optional: false },
      { jsonName: 'address', type: { kind: 'object', name: 'Address' }, nullable: false, optional: false },
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it('merges the objects of an array: missing means optional, null means nullable', () => {
    const model = infer(
      '{"items":[{"id":1,"note":"a","tag":null},{"id":2,"tag":"x"},{"id":3,"note":"c","tag":"y"}]}',
    );
    expect(property(model, 'Root', 'items')?.type).toEqual({
      kind: 'array',
      items: { kind: 'object', name: 'Item' },
    });
    expect(declaration(model, 'Item')?.properties).toEqual([
      { jsonName: 'id', type: { kind: 'integer', bits: 32 }, nullable: false, optional: false },
      { jsonName: 'note', type: { kind: 'string' }, nullable: false, optional: true },
      { jsonName: 'tag', type: { kind: 'string' }, nullable: true, optional: false },
    ]);
  });

  it('tells integers from decimals across all samples, by how the number is written', () => {
    const model = infer('[{"a":1,"b":1,"c":1,"d":2.5},{"a":2,"b":2.5,"c":10.0,"d":3}]');
    expect(declaration(model, 'Root')?.properties.map((p) => p.type)).toEqual([
      { kind: 'integer', bits: 32 },
      { kind: 'decimal' },
      { kind: 'decimal' },
      { kind: 'decimal' },
    ]);
    expect(infer('1e3').root.type).toEqual({ kind: 'decimal' });
  });

  it('widens integers that do not fit in 32 bits, or in 64', () => {
    expect(infer('[2147483647, -2147483648]').root.type).toEqual({
      kind: 'array',
      items: { kind: 'integer', bits: 32 },
    });
    expect(infer('[1, 2147483648]').root.type).toEqual({
      kind: 'array',
      items: { kind: 'integer', bits: 64 },
    });
    expect(infer('[1, -9223372036854775808]').root.type).toEqual({
      kind: 'array',
      items: { kind: 'integer', bits: 64 },
    });
    expect(infer('[1, 9223372036854775808]').root.type).toEqual({
      kind: 'array',
      items: { kind: 'integer', bits: 'big' },
    });
  });

  it('recognises strings that are always dates, date-times or GUIDs', () => {
    const model = infer(`[
      {"at":"2026-10-18T12:30:00Z","day":"2026-10-18","id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301","local":"2026-10-18 12:30"},
      {"at":"2026-10-18T12:30:00.123+01:00","day":"2024-02-29","id":"3F2504E0-4F89-11D3-9A0C-0305E82C3301","local":"2026-10-18T08:00"}
    ]`);
    expect(declaration(model, 'Root')?.properties.map((p) => [p.jsonName, p.type.kind])).toEqual([
      ['at', 'dateTime'],
      ['day', 'date'],
      ['id', 'guid'],
      ['local', 'dateTime'],
    ]);
  });

  it('keeps a plain string when any sample breaks the pattern', () => {
    const model = infer(`[
      {"day":"2026-10-18","at":"2026-10-18T12:00:00Z","id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301"},
      {"day":"2026-02-30","at":"","id":"not-a-guid"}
    ]`);
    expect(declaration(model, 'Root')?.properties.map((p) => p.type.kind)).toEqual([
      'string',
      'string',
      'string',
    ]);
  });

  it('reports values of different kinds instead of guessing', () => {
    const model = infer('{"values":[1,"two",3],"either":{"a":1}}');
    expect(property(model, 'Root', 'values')?.type).toEqual({ kind: 'array', items: { kind: 'any' } });
    expect(model.diagnostics).toEqual([
      {
        path: '$.values[*]',
        severity: 'warning',
        message: 'Values of different kinds here (string, number), so the type is unknown.',
      },
    ]);
  });

  it('reports what it cannot know: empty arrays and only nulls', () => {
    const model = infer('{"tags":[],"deletedAt":null}');
    expect(property(model, 'Root', 'tags')).toMatchObject({
      type: { kind: 'array', items: { kind: 'any' } },
    });
    expect(property(model, 'Root', 'deletedAt')).toMatchObject({ type: { kind: 'any' }, nullable: true });
    expect(model.diagnostics.map((d) => [d.path, d.severity])).toEqual([
      ['$.tags', 'info'],
      ['$.deletedAt', 'info'],
    ]);
  });

  it('learns item types from later arrays when the first ones are empty', () => {
    const model = infer('[{"tags":[]},{"tags":["a","b"]}]');
    expect(property(model, 'Root', 'tags')?.type).toEqual({ kind: 'array', items: { kind: 'string' } });
    expect(model.diagnostics).toEqual([]);
  });

  it('handles empty objects, a top-level array and a top-level primitive', () => {
    expect(infer('{}')).toEqual({
      root: { type: { kind: 'object', name: 'Root' }, nullable: false },
      declarations: [{ name: 'Root', properties: [] }],
      diagnostics: [],
    });
    const list = infer('[{"id":1},{"id":2}]', { rootName: 'Order' });
    expect(list.root.type).toEqual({ kind: 'array', items: { kind: 'object', name: 'Order' } });
    expect(list.declarations.map((d) => d.name)).toEqual(['Order']);
    expect(infer('"hi"')).toEqual({
      root: { type: { kind: 'string' }, nullable: false },
      declarations: [],
      diagnostics: [],
    });
    expect(infer('[[{"x":1}]]').root.type).toEqual({
      kind: 'array',
      items: { kind: 'array', items: { kind: 'object', name: 'Root' } },
    });
  });

  it('names nested types after their property, singular for array items', () => {
    const model = infer(
      '{"categories":[{"id":1}],"addresses":[{"street":"a"}],"people":[{"name":"b"}],"data":[{"v":1}],"status":{"ok":true}}',
    );
    expect(model.declarations.map((d) => d.name)).toEqual([
      'Root',
      'Category',
      'Address',
      'Person',
      'DataItem',
      'Status',
    ]);
  });

  it('shares one type between identical shapes and numbers clashing names', () => {
    const model = infer(
      '{"billing":{"address":{"street":"a","city":"b"}},"shipping":{"address":{"street":"c","city":"d"}},"office":{"address":{"line":"e"}}}',
    );
    expect(model.declarations.map((d) => d.name)).toEqual([
      'Root',
      'Billing',
      'Address',
      'Office',
      'Address2',
    ]);
    expect(property(model, 'Root', 'shipping')?.type).toEqual({ kind: 'object', name: 'Billing' });
  });

  it('copes with odd property names', () => {
    const model = infer(
      '{"first name":{"a":1},"last-name":{"b":1},"2fa":{"c":1},"class":{"d":1},"string":{"e":1},"":{"f":1},"endereço":{"g":1},"$ref":{"h":1}}',
    );
    expect(model.declarations.map((d) => d.name)).toEqual([
      'Root',
      'FirstName',
      'LastName',
      'Item2fa',
      'Class',
      'StringItem',
      'Item',
      'Endereço',
      'Ref',
    ]);
    expect(declaration(model, 'Root')?.properties.map((p) => p.jsonName)).toEqual([
      'first name',
      'last-name',
      '2fa',
      'class',
      'string',
      '',
      'endereço',
      '$ref',
    ]);
  });

  it('warns about a key repeated in one object and keeps the last value, as JSON.parse does', () => {
    const model = infer('{"a":1,"a":"x"}');
    expect(property(model, 'Root', 'a')?.type).toEqual({ kind: 'string' });
    expect(model.diagnostics).toEqual([
      {
        path: '$.a',
        severity: 'warning',
        message: 'The key "a" appears more than once in the same object; the last value is used.',
      },
    ]);
  });

  it('writes paths with brackets for keys that are not identifiers', () => {
    const model = infer('{"odd key":[null]}');
    expect(model.diagnostics[0]?.path).toBe('$["odd key"][*]');
  });

  it('infers a large sample quickly', () => {
    const json = JSON.stringify(
      Array.from({ length: 10_000 }, (_, i) => ({
        id: i,
        name: `item ${String(i)}`,
        price: i / 7,
        tags: ['a', 'b'],
        owner: { id: i % 50, since: '2026-01-01' },
      })),
    );
    const start = performance.now();
    const model = infer(json);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(model.declarations.map((d) => d.name)).toEqual(['Root', 'Owner']);
  });
});
