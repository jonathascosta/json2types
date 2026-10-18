import { describe, expect, it } from 'vitest';
import { inferModel, parseJson } from '../infer';
import { generateCSharp, namespaceName, stringLiteral, type CSharpOptions } from './csharp';

function csharp(json: string, options: CSharpOptions = {}, rootName?: string): string {
  return generateCSharp(inferModel(parseJson(json), { rootName }), options);
}

const lines = (...text: string[]) => text.join('\n') + '\n';

const SAMPLE =
  '{"id": 7, "first_name": "Ana", "tags": ["a", null], "address": {"city": "Porto"}, "note": null}';

describe('generateCSharp', () => {
  it('writes classes with System.Text.Json attributes and nullable reference types by default', () => {
    expect(csharp(SAMPLE)).toBe(
      lines(
        '#nullable enable',
        '',
        'using System.Collections.Generic;',
        'using System.Text.Json.Serialization;',
        '',
        'public class Root',
        '{',
        '    [JsonPropertyName("id")]',
        '    public int Id { get; set; }',
        '    [JsonPropertyName("first_name")]',
        '    public string FirstName { get; set; } = "";',
        '    [JsonPropertyName("tags")]',
        '    public List<string?> Tags { get; set; } = [];',
        '    [JsonPropertyName("address")]',
        '    public Address Address { get; set; } = new();',
        '    [JsonPropertyName("note")]',
        '    public object? Note { get; set; }',
        '}',
        '',
        'public class Address',
        '{',
        '    [JsonPropertyName("city")]',
        '    public string City { get; set; } = "";',
        '}',
      ),
    );
  });

  it('writes records with init accessors', () => {
    expect(csharp('{"Name": "x"}', { kind: 'record' })).toBe(
      lines(
        '#nullable enable',
        '',
        'public record Root',
        '{',
        '    public string Name { get; init; } = "";',
        '}',
      ),
    );
  });

  it('writes Newtonsoft attributes', () => {
    expect(csharp('{"first_name": "x", "Age": 1}', { attributes: 'newtonsoft' })).toBe(
      lines(
        '#nullable enable',
        '',
        'using Newtonsoft.Json;',
        '',
        'public class Root',
        '{',
        '    [JsonProperty("first_name")]',
        '    public string FirstName { get; set; } = "";',
        '    public int Age { get; set; }',
        '}',
      ),
    );
  });

  it('writes no attributes when asked not to', () => {
    expect(csharp('{"first_name": "x"}', { attributes: 'none' })).toBe(
      lines(
        '#nullable enable',
        '',
        'public class Root',
        '{',
        '    public string FirstName { get; set; } = "";',
        '}',
      ),
    );
  });

  it('leaves nullable reference types off: no ? on references, no initialisers', () => {
    expect(csharp(SAMPLE, { nullable: false, attributes: 'none' })).toBe(
      lines(
        '#nullable disable',
        '',
        'using System.Collections.Generic;',
        '',
        'public class Root',
        '{',
        '    public int Id { get; set; }',
        '    public string FirstName { get; set; }',
        '    public List<string> Tags { get; set; }',
        '    public Address Address { get; set; }',
        '    public object Note { get; set; }',
        '}',
        '',
        'public class Address',
        '{',
        '    public string City { get; set; }',
        '}',
      ),
    );
  });

  it('keeps ? on value types without nullable reference types', () => {
    expect(
      csharp('[{"n": 1, "s": "a"}, {"n": null, "s": null}]', { nullable: false, attributes: 'none' }),
    ).toContain('    public int? N { get; set; }\n    public string S { get; set; }\n');
  });

  it('writes arrays instead of lists, nested and nullable', () => {
    const code = csharp('{"m": [[1, 2], null], "s": [["a", null]], "e": [], "o": [{"a": 1}]}', {
      collection: 'array',
      attributes: 'none',
    });
    expect(code).toContain('    public int[]?[] M { get; set; } = [];\n');
    expect(code).toContain('    public string?[][] S { get; set; } = [];\n');
    expect(code).toContain('    public object?[] E { get; set; } = [];\n');
    expect(code).toContain('    public OItem[] O { get; set; } = [];\n');
    expect(code).not.toContain('using System.Collections.Generic;');
  });

  it('writes nested lists with nullable items', () => {
    expect(csharp('{"m": [[1, null], null]}', { attributes: 'none' })).toContain(
      '    public List<List<int?>?> M { get; set; } = [];\n',
    );
  });

  it('puts the types in a file-scoped namespace', () => {
    expect(csharp('{"a": true}', { namespace: 'Shop.Models', attributes: 'none' })).toBe(
      lines(
        '#nullable enable',
        '',
        'namespace Shop.Models;',
        '',
        'public class Root',
        '{',
        '    public bool A { get; set; }',
        '}',
      ),
    );
  });

  it('names the root type as inferModel was told', () => {
    expect(csharp('{"a": true}', { attributes: 'none' }, 'order line')).toContain('public class OrderLine\n');
  });

  it('maps every inferred type', () => {
    const json = `{
      "s": "x", "zoned": "2026-10-18T12:00:00Z", "local": "2026-10-18T12:00:00",
      "mixed": ["2026-10-18T12:00:00Z", "2026-10-18"], "day": "2026-10-18",
      "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "i": 1, "l": 3000000000,
      "big": 123456789012345678901234567890, "d": 1.5, "f": 1e300, "b": false, "any": [1, "x"]
    }`;
    const types = (options: CSharpOptions) =>
      [
        ...csharp(json, { ...options, attributes: options.attributes ?? 'none' }).matchAll(
          /public (\S+) \S+ \{/g,
        ),
      ].map((m) => m[1]);
    expect(types({})).toEqual([
      'string',
      'DateTimeOffset',
      'DateTime',
      'List<DateTimeOffset>',
      'DateOnly',
      'Guid',
      'int',
      'long',
      'Int128',
      'decimal',
      'double',
      'bool',
      'List<object?>',
    ]);
    // Newtonsoft reads integers beyond 64 bits as BigInteger, and not Int128.
    expect(types({ attributes: 'newtonsoft' })[8]).toBe('BigInteger');
    expect(types({ nullable: false })[8]).toBe('Int128');
    expect(csharp(json, { attributes: 'newtonsoft' })).toContain(
      'using System;\nusing System.Collections.Generic;\nusing System.Numerics;\nusing Newtonsoft.Json;\n',
    );
  });

  it('reads integers past Int128 as double with System.Text.Json, saying they are rounded', () => {
    const json = '{"a": [1, 170141183460469231731687303715884105728], "b": 1}';
    expect(csharp(json, { attributes: 'none' })).toBe(
      lines(
        '#nullable enable',
        '',
        'using System.Collections.Generic;',
        '',
        'public class Root',
        '{',
        '    // Integers here go past Int128, so they are read as double, which rounds them.',
        '    public List<double> A { get; set; } = [];',
        '    public int B { get; set; }',
        '}',
      ),
    );
    expect(csharp(json, { attributes: 'newtonsoft' })).toContain(
      '    public List<BigInteger> A { get; set; } = [];\n',
    );
    expect(csharp(json, { attributes: 'newtonsoft' })).not.toContain('rounds');
    expect(
      csharp('[1e40, 3e39]'.replace(/(\d)e(\d+)/g, (_, d: string, e: string) => d + '0'.repeat(Number(e)))),
    ).toBe(
      lines(
        '// Integers here go past Int128, so they are read as double, which rounds them.',
        '// There are no types to declare: deserialise the JSON as List<double>.',
      ),
    );
  });

  it('makes properties missing from some objects nullable', () => {
    const code = csharp('[{"a": 1, "b": "x", "c": {"d": 1}}, {}]', { attributes: 'none' });
    expect(code).toContain('    public int? A { get; set; }\n');
    expect(code).toContain('    public string? B { get; set; }\n');
    expect(code).toContain('    public C? C { get; set; }\n');
  });

  it('says how to read a root that is not an object', () => {
    expect(csharp('[{"a": 1}]', { attributes: 'none' })).toBe(
      lines(
        '#nullable enable',
        '',
        '// Deserialise the JSON as List<Root>.',
        '',
        'public class Root',
        '{',
        '    public int A { get; set; }',
        '}',
      ),
    );
    expect(csharp('[{"a": 1}, null]', { collection: 'array', attributes: 'none' })).toContain(
      '// Deserialise the JSON as Root?[].\n',
    );
  });

  it('writes only a comment when there is nothing to declare', () => {
    expect(csharp('[1, 2]', { namespace: 'A' })).toBe(
      '// There are no types to declare: deserialise the JSON as List<int>.\n',
    );
    expect(csharp('null')).toBe('// There are no types to declare: deserialise the JSON as object?.\n');
    expect(csharp('null', { nullable: false })).toBe(
      '// There are no types to declare: deserialise the JSON as object.\n',
    );
    expect(csharp('[1, {"a": 1}]')).toBe(
      '// There are no types to declare: deserialise the JSON as List<object?>.\n',
    );
    expect(csharp('"x"')).toBe('// There are no types to declare: deserialise the JSON as string.\n');
  });

  it('uses the member names the model gives, with the JSON names in attributes', () => {
    const code = csharp('{"user": {"user": 1, "User": 2}, "ToString": "x", "class": 1, "名前": "n"}');
    expect(code).toContain('    [JsonPropertyName("user")]\n    public int UserValue { get; set; }\n');
    expect(code).toContain('    [JsonPropertyName("User")]\n    public int UserValue2 { get; set; }\n');
    expect(code).toContain(
      '    [JsonPropertyName("ToString")]\n    public string ToStringValue { get; set; } = "";\n',
    );
    expect(code).toContain('    [JsonPropertyName("class")]\n    public int Class { get; set; }\n');
    expect(code).toContain('    public string 名前 { get; set; } = "";\n');
    expect(code).not.toContain('[JsonPropertyName("名前")]');
  });

  it('escapes JSON names in attributes', () => {
    expect(csharp('{"say \\"hi\\" \\\\ now\\u2028": 1}')).toContain(
      '    [JsonPropertyName("say \\"hi\\" \\\\ now\\u2028")]\n    public int SayHiNow { get; set; }\n',
    );
  });
});

describe('stringLiteral', () => {
  it('escapes quotes, backslashes and characters that would break or hide in the source', () => {
    expect(stringLiteral('plain é 名 😀')).toBe('"plain é 名 😀"');
    expect(stringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(stringLiteral('\n\r\t\0\u007f\u0085  ')).toBe(
      '"\\u000A\\u000D\\u0009\\u0000\\u007F\\u0085\\u2028\\u2029"',
    );
    // Format characters, such as bidirectional overrides, and a byte order mark.
    expect(stringLiteral('a‮b​c﻿')).toBe('"a\\u202Eb\\u200Bc\\uFEFF"');
  });

  it('escapes lone surrogates and keeps pairs', () => {
    expect(stringLiteral('\uD800x\uDC00😀')).toBe('"\\uD800x\\uDC00😀"');
    expect(stringLiteral('\uD83D')).toBe('"\\uD83D"');
  });
});

describe('namespaceName', () => {
  it.each([
    ['Shop.Models', 'Shop.Models'],
    ['', ''],
    ['  ', ''],
    ['My App.class.1x', 'My_App.@class._1x'],
    ['a..b.', 'a.b'],
    [' Shop . Models ', 'Shop.Models'],
    ['Café.Ünits', 'Café.Ünits'],
    ['global.System', '@global.System'],
    ['x-y.😀z', 'x_y._z'],
    ['_private', '_private'],
    ['Foo.__arglist.__makeref.__reftype.__refvalue', 'Foo.@__arglist.@__makeref.@__reftype.@__refvalue'],
  ])('%j → %j', (input, expected) => {
    expect(namespaceName(input)).toBe(expected);
  });
});
