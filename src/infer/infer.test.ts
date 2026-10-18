import { describe, expect, it } from 'vitest';
import { inferModel, type InferOptions } from './infer';
import type { Model } from './model';
import { parseJson } from './parse';

const infer = (json: string, options?: InferOptions): Model => inferModel(parseJson(json), options);
const declaration = (model: Model, name: string) => model.declarations.find((d) => d.name === name);
const property = (model: Model, type: string, jsonName: string) =>
  declaration(model, type)?.properties.find((p) => p.jsonName === jsonName);
const names = (model: Model) => model.declarations.map((d) => d.name);
const kinds = (model: Model, type = 'Root') =>
  declaration(model, type)?.properties.map((p) => [p.jsonName, p.type.kind]);
const plain = <T>(type: T) => ({ type, nullable: false });

describe('inferModel', () => {
  it('describes every kind of value, nested to any depth', () => {
    const model = infer(
      '{"name":"Ana","age":30,"score":9.5,"active":true,"address":{"city":"Porto","geo":{"lat":41.1}}}',
    );
    expect(model.root).toEqual(plain({ kind: 'object', name: 'Root' }));
    expect(names(model)).toEqual(['Root', 'Address', 'Geo']);
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
      items: plain({ kind: 'object', name: 'Item' }),
    });
    expect(declaration(model, 'Item')?.properties).toEqual([
      { jsonName: 'id', type: { kind: 'integer', bits: 32 }, nullable: false, optional: false },
      { jsonName: 'note', type: { kind: 'string' }, nullable: false, optional: true },
      { jsonName: 'tag', type: { kind: 'string' }, nullable: true, optional: false },
    ]);
  });

  it('keeps null array items as nullable items, at any depth', () => {
    expect(infer('[1, null, 2]').root.type).toEqual({
      kind: 'array',
      items: { type: { kind: 'integer', bits: 32 }, nullable: true },
    });
    expect(infer('[{"a":1}, null]').root.type).toEqual({
      kind: 'array',
      items: { type: { kind: 'object', name: 'Root' }, nullable: true },
    });
    expect(infer('[["a", null], null]').root.type).toEqual({
      kind: 'array',
      items: { type: { kind: 'array', items: { type: { kind: 'string' }, nullable: true } }, nullable: true },
    });
  });

  it('tells integers from decimals across all samples, by how the number is written', () => {
    const model = infer('[{"a":1,"b":1,"c":1,"d":2.5},{"a":2,"b":2.5,"c":10.0,"d":3}]');
    expect(kinds(model)).toEqual([
      ['a', 'integer'],
      ['b', 'decimal'],
      ['c', 'decimal'],
      ['d', 'decimal'],
    ]);
    expect(infer('1e3').root.type).toEqual({ kind: 'decimal' });
  });

  it('widens integers that do not fit in 32 bits, or in 64', () => {
    const items = (json: string) => (infer(json).root.type as { items: { type: unknown } }).items.type;
    expect(items('[2147483647, -2147483648]')).toEqual({ kind: 'integer', bits: 32 });
    expect(items('[1, 2147483648]')).toEqual({ kind: 'integer', bits: 64 });
    expect(items('[1, -9223372036854775808]')).toEqual({ kind: 'integer', bits: 64 });
    expect(items('[1, 9223372036854775808]')).toEqual({ kind: 'integer', bits: 'big' });
  });

  it('recognises strings that are always dates, date-times or GUIDs', () => {
    const model = infer(`[
      {"at":"2026-10-18T12:30:00Z","day":"2026-10-18","id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301","local":"2026-10-18T12:30"},
      {"at":"2026-10-18T12:30:00.1234567+01:00","day":"2024-02-29","id":"3F2504E0-4F89-11D3-9A0C-0305E82C3301","local":"2026-10-18T08:00:00"}
    ]`);
    expect(declaration(model, 'Root')?.properties.map((p) => [p.jsonName, p.type])).toEqual([
      ['at', { kind: 'dateTime', offset: 'always' }],
      ['day', { kind: 'date' }],
      ['id', { kind: 'guid' }],
      ['local', { kind: 'dateTime', offset: 'never' }],
    ]);
  });

  it('records mixed offsets, and widens dates mixed with date-times to date-times', () => {
    const model = infer(
      '[{"a":"2026-10-18T12:00:00Z","b":"2026-10-18"},{"a":"2026-10-18T12:00:00","b":"2026-10-18T12:00:00Z"}]',
    );
    expect(declaration(model, 'Root')?.properties.map((p) => p.type)).toEqual([
      { kind: 'dateTime', offset: 'mixed' },
      { kind: 'dateTime', offset: 'mixed' },
    ]);
  });

  it('keeps a plain string when any sample breaks the pattern', () => {
    const model = infer(`[
      {"day":"2026-10-18","at":"2026-10-18T12:00:00Z","id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301"},
      {"day":"2026-02-30","at":"","id":"not-a-guid"}
    ]`);
    expect(kinds(model)?.map(([, kind]) => kind)).toEqual(['string', 'string', 'string']);
  });

  it.each([
    ['a space instead of T', '2026-10-18 12:00:00'],
    ['an offset without a colon', '2026-10-18T12:00:00+0100'],
    ['an out-of-range offset', '2026-10-18T12:00:00+99:99'],
    ['an hour of 24', '2026-10-18T24:00:00Z'],
    ['more than seven fraction digits', '2026-10-18T12:00:00.12345678Z'],
  ])('reads a date-time with %s as a plain string, as System.Text.Json would', (_, value) => {
    expect(infer(JSON.stringify(value)).root.type).toEqual({ kind: 'string' });
  });

  it('checks dates in years below 100 properly', () => {
    expect(infer('"0004-02-29"').root.type).toEqual({ kind: 'date' });
    expect(infer('"0001-02-29"').root.type).toEqual({ kind: 'string' });
  });

  it('reports values of different kinds instead of guessing', () => {
    const model = infer('{"values":[1,"two",3],"either":{"a":1}}');
    expect(property(model, 'Root', 'values')?.type).toEqual({ kind: 'array', items: plain({ kind: 'any' }) });
    expect(model.diagnostics).toEqual([
      {
        path: '$.values[*]',
        severity: 'warning',
        message: 'Values of different kinds here (string, number), so the type is unknown.',
        count: 1,
      },
    ]);
  });

  it('reports what it cannot know: empty arrays and only nulls', () => {
    const model = infer('{"tags":[],"deletedAt":null}');
    expect(property(model, 'Root', 'tags')).toMatchObject({
      type: { kind: 'array', items: plain({ kind: 'any' }) },
    });
    expect(property(model, 'Root', 'deletedAt')).toMatchObject({ type: { kind: 'any' }, nullable: true });
    expect(model.diagnostics.map((d) => [d.path, d.severity])).toEqual([
      ['$.tags', 'info'],
      ['$.deletedAt', 'info'],
    ]);
  });

  it('learns item types from later arrays when the first ones are empty', () => {
    const model = infer('[{"tags":[]},{"tags":["a","b"]}]');
    expect(property(model, 'Root', 'tags')?.type).toEqual({
      kind: 'array',
      items: plain({ kind: 'string' }),
    });
    expect(model.diagnostics).toEqual([]);
  });

  it('handles empty objects, a top-level array and a top-level primitive', () => {
    expect(infer('{}')).toEqual({
      root: plain({ kind: 'object', name: 'Root' }),
      declarations: [{ name: 'Root', properties: [] }],
      diagnostics: [],
    });
    const list = infer('[{"id":1},{"id":2}]', { rootName: 'Order' });
    expect(list.root.type).toEqual({ kind: 'array', items: plain({ kind: 'object', name: 'Order' }) });
    expect(names(list)).toEqual(['Order']);
    expect(infer('"hi"')).toEqual({ root: plain({ kind: 'string' }), declarations: [], diagnostics: [] });
    expect(infer('[[{"x":1}]]').root.type).toEqual({
      kind: 'array',
      items: plain({ kind: 'array', items: plain({ kind: 'object', name: 'Root' }) }),
    });
  });

  it('gives the root its name even when a property claims the same one', () => {
    expect(names(infer('{"order":{"id":1},"total":2}', { rootName: 'Order' }))).toEqual(['Order', 'Order2']);
    expect(names(infer('{"root":{"x":1}}'))).toEqual(['Root', 'Root2']);
    expect(names(infer('[{"items":[{"x":1}]}]', { rootName: 'Item' }))).toEqual(['Item', 'Item2']);
  });

  it('names outer types first, so nesting does not push them to numbered names', () => {
    const model = infer('{"a":{"a":{"a":{"x":1}}}}');
    expect(names(model)).toEqual(['Root', 'A', 'A2', 'A3']);
    expect(property(model, 'Root', 'a')?.type).toEqual({ kind: 'object', name: 'A' });
  });

  it('names nested types after their property, singular for array items', () => {
    const model = infer(
      '{"categories":[{"id":1}],"addresses":[{"street":"a"}],"people":[{"name":"b"}],"data":[{"v":1}],"status":{"ok":true}}',
    );
    expect(names(model)).toEqual(['Root', 'Category', 'Address', 'Person', 'DataItem', 'Status']);
  });

  it('keeps item names off built-in type names', () => {
    const model = infer(
      '{"errors":[{"code":1}],"responses":[{"ok":true}],"dates":[{"d":1}],"events":[{"e":1}],"types":[{"t":1}]}',
    );
    expect(names(model)).toEqual(['Root', 'ErrorItem', 'ResponseItem', 'DateItem', 'EventItem', 'TypeItem']);
  });

  it('shares one type between identical shapes, whatever their property order', () => {
    const model = infer(
      '{"billing":{"address":{"street":"a","city":"b"}},"shipping":{"address":{"city":"d","street":"c"}},"office":{"address":{"line":"e"}}}',
    );
    expect(names(model)).toEqual(['Root', 'Billing', 'Office', 'Address', 'Address2']);
    expect(property(model, 'Root', 'shipping')?.type).toEqual({ kind: 'object', name: 'Billing' });
    expect(declaration(model, 'Address')?.properties.map((p) => p.jsonName)).toEqual(['street', 'city']);
  });

  it('does not share empty objects between unrelated properties', () => {
    expect(names(infer('{"meta":{},"extra":{}}'))).toEqual(['Root', 'Meta', 'Extra']);
  });

  it('copes with odd property names', () => {
    const model = infer(
      '{"first name":{"a":1},"last-name":{"b":1},"2fa":{"c":1},"class":{"d":1},"string":{"e":1},"":{"f":1},"endereço":{"g":1},"$ref":{"h":1}}',
    );
    expect(names(model)).toEqual([
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

  it('warns once per place about a repeated key, with a count, and keeps the last value', () => {
    const model = infer('[{"a":1,"a":"x"},{"a":2,"a":"y"}]');
    expect(property(model, 'Root', 'a')?.type).toEqual({ kind: 'string' });
    expect(model.diagnostics).toEqual([
      {
        path: '$[*].a',
        severity: 'warning',
        message: 'The key "a" appears more than once in the same object; the last value is used.',
        count: 2,
      },
    ]);
  });

  it('writes paths with brackets for keys that are not identifiers', () => {
    const model = infer('{"odd key":[null]}');
    expect(model.diagnostics[0]?.path).toBe('$["odd key"][*]');
  });

  it('infers a large sample in reasonable time', () => {
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
    // Generous, so a slow CI runner doesn't fail it; locally it takes a small fraction of this.
    expect(performance.now() - start).toBeLessThan(3000);
    expect(names(model)).toEqual(['Root', 'Owner']);
  });
});
