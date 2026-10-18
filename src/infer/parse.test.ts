import { describe, expect, it } from 'vitest';
import { JsonParseError, MAX_DEPTH, parseJson, type JsonValue } from './parse';

/** The parsed value as plain JavaScript, to compare with JSON.parse. */
function toPlain(value: JsonValue): unknown {
  switch (value.type) {
    case 'object':
      return Object.fromEntries(value.entries.map((e) => [e.key, toPlain(e.value)]));
    case 'array':
      return value.items.map(toPlain);
    case 'number':
      return Number(value.raw);
    case 'null':
      return null;
    default:
      return value.value;
  }
}

function errorOf(text: string): JsonParseError {
  try {
    parseJson(text);
  } catch (error) {
    if (error instanceof JsonParseError) return error;
    throw error;
  }
  throw new Error(`Expected ${text} to fail`);
}

describe('parseJson', () => {
  it('parses every kind of value', () => {
    expect(parseJson('{"a": [1, "x", true, false, null], "b": {}}')).toEqual({
      type: 'object',
      entries: [
        {
          key: 'a',
          value: {
            type: 'array',
            items: [
              { type: 'number', raw: '1' },
              { type: 'string', value: 'x' },
              { type: 'boolean', value: true },
              { type: 'boolean', value: false },
              { type: 'null' },
            ],
          },
        },
        { key: 'b', value: { type: 'object', entries: [] } },
      ],
    });
  });

  it('keeps the text of numbers, which JSON.parse loses', () => {
    expect(parseJson('10.0')).toEqual({ type: 'number', raw: '10.0' });
    expect(parseJson('9007199254740993')).toEqual({ type: 'number', raw: '9007199254740993' });
    expect(parseJson('-1.5e-3')).toEqual({ type: 'number', raw: '-1.5e-3' });
  });

  it('decodes escapes, including surrogate pairs written as escapes', () => {
    const text = String.raw`"a\"b\\c\/d\n\t\u00e9\ud83d\ude00"`;
    expect(parseJson(text)).toEqual({ type: 'string', value: 'a"b\\c/d\n\t\u00e9\u{1F600}' });
    expect(parseJson(text)).toEqual({ type: 'string', value: JSON.parse(text) as string });
  });

  it('decodes every escape and accepts what JSON.parse accepts', () => {
    const texts = [String.raw`"\b\f\r\u00C9\uD83D\uDE00"`, '-0', '1E+2', '1e-2', '0.5', '[-0.0]', '{"":""}'];
    for (const text of texts) {
      expect(JSON.stringify(toPlain(parseJson(text)))).toBe(JSON.stringify(JSON.parse(text)));
    }
  });

  it('keeps a lone surrogate escape, as JSON.parse does', () => {
    expect(parseJson(String.raw`"\ud800x"`)).toEqual({ type: 'string', value: '\ud800x' });
  });

  it('rejects whitespace JSON does not allow', () => {
    expect(errorOf('[1,\f2]').message).toBe('Expected a value, found U+000C (line 1, column 4)');
    expect(errorOf('[1,\v2]').message).toBe('Expected a value, found U+000B (line 1, column 4)');
  });

  it('accepts a byte order mark and surrounding whitespace', () => {
    expect(parseJson('﻿ \n [ ] \r\n')).toEqual({ type: 'array', items: [] });
  });

  it('keeps repeated keys, in order, for the caller to decide', () => {
    expect(parseJson('{"a":1,"a":2}')).toEqual({
      type: 'object',
      entries: [
        { key: 'a', value: { type: 'number', raw: '1' } },
        { key: 'a', value: { type: 'number', raw: '2' } },
      ],
    });
  });

  it.each([
    ['', 'Expected a value, found the end of the input', 1, 1],
    ['{"a": 1,}', 'Trailing comma before }', 1, 8],
    ['[1, 2,]', 'Trailing comma before ]', 1, 6],
    ['{\n  "a": 1\n  "b": 2\n}', "Expected '}' or a comma after a property, found '\"'", 3, 3],
    ["{'a': 1}", 'Expected a property name in quotes, found U+0027', 1, 2],
    ['{"a" 1}', "Expected ':' after a property name, found '1'", 1, 6],
    ['"abc', 'Unterminated string', 1, 1],
    ['"a\tb"', 'Control characters must be escaped in strings, found U+0009', 1, 3],
    [String.raw`"\x"`, "Invalid escape: a backslash followed by 'x'", 1, 2],
    ['"\\\n"', 'Invalid escape: a backslash followed by U+000A', 1, 2],
    [String.raw`"\u12"`, String.raw`Invalid \u escape: expected four hex digits`, 1, 2],
    ['tru', 'Invalid literal: expected true, false or null', 1, 1],
    ['01', 'Invalid number', 1, 1],
    ['1.', 'Invalid number', 1, 1],
    ['{} x', "Unexpected 'x' after the JSON value", 1, 4],
    ['NaN', "Expected a value, found 'N'", 1, 1],
    ['-', 'Invalid number', 1, 1],
    ['-a', 'Invalid number', 1, 1],
    ['-.5', 'Invalid number', 1, 1],
    ['-01', 'Invalid number', 1, 1],
    ['+1', "Expected a value, found '+'", 1, 1],
    ['.5', "Expected a value, found '.'", 1, 1],
    ['{"a":}', "Expected a value, found '}'", 1, 6],
    ['[1,,2]', "Expected a value, found ','", 1, 4],
    ['0x1', 'Invalid number', 1, 1],
    ['1e', 'Invalid number', 1, 1],
    ['1e+', 'Invalid number', 1, 1],
    ['[1, 1.5.2]', 'Invalid number', 1, 5],
    ['nul', 'Invalid literal: expected true, false or null', 1, 1],
    ['\uFEFF}', "Expected a value, found '}'", 1, 1],
    ['truex', "Unexpected 'x' after the JSON value", 1, 5],
    ['"ab\\', 'Unterminated string', 1, 1],
  ])('reports %j with its position', (text, message, line, column) => {
    const error = errorOf(text);
    expect(error.message).toBe(`${message} (line ${String(line)}, column ${String(column)})`);
    expect([error.line, error.column]).toEqual([line, column]);
  });

  it('allows exactly MAX_DEPTH levels of nesting, and no more', () => {
    const arrays = (levels: number) => '['.repeat(levels) + '1' + ']'.repeat(levels);
    const objects = (levels: number) => '{"a":'.repeat(levels) + '1' + '}'.repeat(levels);
    expect(() => parseJson(arrays(MAX_DEPTH))).not.toThrow();
    expect(() => parseJson(objects(MAX_DEPTH))).not.toThrow();
    expect(errorOf(arrays(MAX_DEPTH + 1)).message).toMatch(/^Nested more than 500 levels deep/);
    expect(errorOf(objects(MAX_DEPTH + 1)).message).toMatch(/^Nested more than 500 levels deep/);
  });

  it('counts lines ended by \\n, \\r\\n or a lone \\r', () => {
    expect([errorOf('[\n1,\r\n2,\r3 x]').line, errorOf('[\n1,\r\n2,\r3 x]').column]).toEqual([4, 3]);
  });

  it('names invisible characters by code point', () => {
    expect(errorOf('[1,\u00a0 2]').message).toBe('Expected a value, found U+00A0 (line 1, column 4)');
    expect(errorOf('{"a":1}\u2028').message).toBe(
      'Unexpected U+2028 after the JSON value (line 1, column 8)',
    );
    expect(errorOf('[😀]').message).toBe("Expected a value, found '😀' (line 1, column 2)");
  });

  it('treats a lone byte order mark as empty input', () => {
    expect(errorOf('\uFEFF').message).toBe('Expected a value, found the end of the input (line 1, column 1)');
  });

  it('parses half a megabyte in reasonable time', () => {
    const big = JSON.stringify(
      Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `item ${String(i)}`, price: i / 7 })),
    );
    expect(big.length).toBeGreaterThan(500_000);
    const start = performance.now();
    parseJson(big);
    // Generous, so a slow CI runner doesn't fail it; locally it takes a small fraction of this.
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
