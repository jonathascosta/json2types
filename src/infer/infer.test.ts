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
      { jsonName: 'name', name: 'Name', type: { kind: 'string' }, nullable: false, optional: false },
      { jsonName: 'age', name: 'Age', type: { kind: 'integer', bits: 32 }, nullable: false, optional: false },
      { jsonName: 'score', name: 'Score', type: { kind: 'decimal' }, nullable: false, optional: false },
      { jsonName: 'active', name: 'Active', type: { kind: 'boolean' }, nullable: false, optional: false },
      {
        jsonName: 'address',
        name: 'Address',
        type: { kind: 'object', name: 'Address' },
        nullable: false,
        optional: false,
      },
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
      { jsonName: 'id', name: 'Id', type: { kind: 'integer', bits: 32 }, nullable: false, optional: false },
      { jsonName: 'note', name: 'Note', type: { kind: 'string' }, nullable: false, optional: true },
      { jsonName: 'tag', name: 'Tag', type: { kind: 'string' }, nullable: true, optional: false },
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
    ['more than sixteen fraction digits', '2026-10-18T12:00:00.12345678901234567Z'],
    ['an offset beyond 14 hours', '2026-10-18T12:00:00+14:01'],
    ['year 0, before .NET dates begin', '0000-01-01T00:00:00Z'],
  ])('reads a date-time with %s as a plain string, as System.Text.Json would', (_, value) => {
    expect(infer(JSON.stringify(value)).root.type).toEqual({ kind: 'string' });
  });

  it('checks dates in years below 100 properly, and refuses year 0', () => {
    expect(infer('"0004-02-29"').root.type).toEqual({ kind: 'date' });
    expect(infer('"0001-02-29"').root.type).toEqual({ kind: 'string' });
    expect(infer('"0000-01-01"').root.type).toEqual({ kind: 'string' });
  });

  it('accepts the forms System.Text.Json reads: up to 16 fraction digits, offsets up to ±14:00', () => {
    const at = (value: string) => infer(JSON.stringify(value)).root.type;
    expect(at('2026-10-18T12:00:00.123456789Z')).toEqual({ kind: 'dateTime', offset: 'always' });
    expect(at('2026-10-18T12:00:00.1234567890123456Z')).toEqual({ kind: 'dateTime', offset: 'always' });
    expect(at('2026-10-18T12:00:00+14:00')).toEqual({ kind: 'dateTime', offset: 'always' });
    expect(at('2026-10-18T12:00:00-14:00')).toEqual({ kind: 'dateTime', offset: 'always' });
  });

  it('uses floating point when a fractional number is beyond an exact decimal', () => {
    const items = (json: string) => (infer(json).root.type as { items: { type: unknown } }).items.type;
    expect(items('[1.5, 79228162514264337593543950335.0]')).toEqual({ kind: 'decimal' });
    expect(items('[1.5, 7.9e28, -7.9e28, 1e-28, 0.0000000000000000000000000001]')).toEqual({
      kind: 'decimal',
    });
    expect(items('[1.5, 79228162514264337593543950335.4]')).toEqual({ kind: 'decimal' });
    expect(items('[1.5, 79228162514264337593543950335.5]')).toEqual({ kind: 'float' });
    // Smaller than a decimal's smallest step, 1e-28: System.Text.Json would read it as 0.
    expect(items('[2.5, 1.5e-35]')).toEqual({ kind: 'float' });
    expect(items('[2.5, 9e-29]')).toEqual({ kind: 'float' });
    expect(items('[1.5, 79228162514264337593543950336.0]')).toEqual({ kind: 'float' });
    expect(items('[1.5, 8e28]')).toEqual({ kind: 'float' });
    expect(items('[1.5, -1e400]')).toEqual({ kind: 'float' });
    expect(items('[1.5, 1e99999999]')).toEqual({ kind: 'float' });
    expect(items('[1.5, 0.000079228162514264337593543950336e33]')).toEqual({ kind: 'float' });
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

  it('shares one type between identical shapes in alike places, whatever their property order', () => {
    const model = infer(
      '{"billing":{"address":{"street":"a","city":"b"}},"shipping":{"address":{"city":"d","street":"c"}},"office":{"address":{"line":"e"}}}',
    );
    expect(names(model)).toEqual(['Root', 'Billing', 'Shipping', 'Office', 'Address', 'Address2']);
    expect(property(model, 'Shipping', 'address')?.type).toEqual({ kind: 'object', name: 'Address' });
    expect(declaration(model, 'Address')?.properties.map((p) => p.jsonName)).toEqual(['street', 'city']);
  });

  it('keeps alike shapes in unrelated places apart', () => {
    expect(names(infer('{"user":{"id":1},"product":{"id":2}}'))).toEqual(['Root', 'User', 'Product']);
  });

  it('shares parents that differ only by empty objects, but not the empty objects themselves', () => {
    const model = infer('[{"a":{"x":{}}},{"a":{"x":{}}}]');
    expect(names(model)).toEqual(['Root', 'A', 'X']);
    expect(names(infer('{"items":[{"x":{}},{"x":{}}]}'))).toEqual(['Root', 'Item', 'X']);
    // q.p is alike root.p (same name, same shape, one empty child), so the two share P.
    expect(names(infer('{"p":{"x":{}},"q":{"p":{"x":{}}}}'))).toEqual(['Root', 'P', 'Q', 'X']);
  });

  it('does not share empty objects between unrelated properties', () => {
    expect(names(infer('{"meta":{},"extra":{}}'))).toEqual(['Root', 'Meta', 'Extra']);
  });

  it('names item types without doubling Item', () => {
    expect(names(infer('{"list":[{"a":1}],"items2":[{"b":1}]}'))).toEqual(['Root', 'ListItem', 'Item2']);
  });

  it('handles keys that are names of Object.prototype members', () => {
    const model = infer(
      '{"constructor":[{"a":1}],"toString":[{"b":1}],"__proto__":[{"c":1}],"myConstructor":[{"d":1}]}',
    );
    expect(names(model)).toEqual([
      'Root',
      'ConstructorItem',
      'ToStringItem',
      'ProtoItem',
      'MyConstructorItem',
    ]);
  });

  it('treats a zero as zero, whatever its exponent', () => {
    expect(infer('[1.5, 0e400, 0.000e50, -0.0]').root.type).toEqual({
      kind: 'array',
      items: plain({ kind: 'decimal' }),
    });
  });

  it('warns about numbers too small even for floating point', () => {
    const model = infer('{"x":[1e-400, 1.5]}');
    expect(property(model, 'Root', 'x')?.type).toEqual({ kind: 'array', items: plain({ kind: 'float' }) });
    expect(model.diagnostics.map((d) => d.message)).toEqual([
      'A number here is too small even for floating point; it reads as 0.',
    ]);
  });

  it('classifies very long integers without slowing down', () => {
    const huge = '9'.repeat(1_000_000);
    const start = performance.now();
    expect(infer(`[${huge}, ${huge}, ${huge}]`).root.type).toEqual({
      kind: 'array',
      items: plain({ kind: 'integer', bits: 'big' }),
    });
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('names thousands of types that want the same name in linear time', () => {
    const json = `{${Array.from({ length: 20_000 }, (_, i) => `"k${String(i)}":{"x":{"v${String(i)}":1}}`).join(',')}}`;
    const start = performance.now();
    const model = infer(json);
    expect(model.declarations.filter((d) => d.name.startsWith('X'))).toHaveLength(20_000);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('does not warn about long integers, which are kept whole', () => {
    const model = infer(`{"x":[${'9'.repeat(400)}, 1]}`);
    expect(property(model, 'Root', 'x')?.type).toEqual({
      kind: 'array',
      items: plain({ kind: 'integer', bits: 'big' }),
    });
    expect(model.diagnostics).toEqual([]);
  });

  it('warns about a long integer that ends up as floating point', () => {
    const model = infer(`{"x":[${'9'.repeat(400)}, 1.5]}`);
    expect(model.diagnostics.map((d) => d.message)).toEqual([
      'A number here is too large even for floating point.',
    ]);
  });

  it('warns about numbers too large even for floating point', () => {
    const model = infer('{"x":[1e400, 1.5]}');
    expect(property(model, 'Root', 'x')?.type).toEqual({ kind: 'array', items: plain({ kind: 'float' }) });
    expect(model.diagnostics).toEqual([
      {
        path: '$.x[*]',
        severity: 'warning',
        message: 'A number here is too large even for floating point.',
        count: 1,
      },
    ]);
  });

  it('refuses date-times whose offset moves them outside the years 1 to 9999', () => {
    const at = (value: string) => infer(JSON.stringify(value)).root.type.kind;
    expect(at('9999-12-31T23:59:59-01:00')).toBe('string');
    expect(at('0001-01-01T00:00:00+01:00')).toBe('string');
    expect(at('9999-12-31T22:59:59-01:00')).toBe('dateTime');
    expect(at('0001-01-01T01:00:00+01:00')).toBe('dateTime');
  });

  it('gives properties member names, unique and never the name of their own type', () => {
    const model = infer('{"user":{"user":"x","first_name":"a","firstName":"b","a":1,"A":2,"a_":3}}');
    expect(declaration(model, 'User')?.properties.map((p) => [p.jsonName, p.name])).toEqual([
      ['user', 'UserValue'],
      ['first_name', 'FirstName'],
      ['firstName', 'FirstName2'],
      ['a', 'A'],
      ['A', 'A2'],
      ['a_', 'A3'],
    ]);
  });

  it('keeps member names off members C# types inherit, and numbers clashes around natural names', () => {
    const model = infer('{"toString":1,"equals":2,"getHashCode":3,"a":4,"A":5,"a2":6}');
    expect(declaration(model, 'Root')?.properties.map((p) => p.name)).toEqual([
      'ToStringValue',
      'EqualsValue',
      'GetHashCodeValue',
      'A',
      'A3',
      'A2',
    ]);
    const user = infer('{"user":{"user":1,"userValue":2}}');
    expect(declaration(user, 'User')?.properties.map((p) => p.name)).toEqual(['UserValue2', 'UserValue']);
  });

  it('names thousands of clashing members in linear time', () => {
    // 20,000 short keys that all become A: a_, a-, a.$, a@_ and so on.
    const separators = ['_', '-', '.', '$', '@', ' '];
    const keys = Array.from({ length: 20_000 }, (_, i) =>
      JSON.stringify(`a${Array.from(i.toString(6), (digit) => separators[Number(digit)] ?? '').join('')}`),
    );
    const json = `{${keys.map((k, i) => `${k}:${String(i)}`).join(',')}}`;
    const start = performance.now();
    const names = declaration(infer(json), 'Root')?.properties.map((p) => p.name) ?? [];
    expect(new Set(names).size).toBe(20_000);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('names a megabyte-long key of capitals quickly', () => {
    const key = JSON.stringify(`${'A'.repeat(1_000_000)}b`);
    const start = performance.now();
    const model = infer(`{${key}:[{"x":1}],${key.slice(0, -2)}s":[{"y":1}]}`);
    expect(model.declarations).toHaveLength(3);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('keeps long keys short in diagnostic paths and messages', () => {
    const key = 'k'.repeat(100);
    const model = infer(`{"${key}":[{"a":1,"a":2}]}`);
    expect(model.diagnostics[0]?.path).toBe(`$["${'k'.repeat(40)}…"][*].a`);
    const nested = infer(`{"${key}":{"${key}":1,"${key}":2}}`);
    expect(nested.diagnostics[0]?.message).toBe(
      `The key "${'k'.repeat(40)}…" appears more than once in the same object; the last value is used.`,
    );
  });

  it('reports repeated keys under a very long path quickly', () => {
    const key = JSON.stringify('k'.repeat(1_000_000));
    const json = `{${key}:[${Array.from({ length: 20_000 }, () => '{"a":1,"a":2}').join(',')}]}`;
    const start = performance.now();
    const model = infer(json);
    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0]?.count).toBe(20_000);
    expect(performance.now() - start).toBeLessThan(5000);
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
    expect(infer('{"$ref":[null]}').diagnostics[0]?.path).toBe('$["$ref"][*]');
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
