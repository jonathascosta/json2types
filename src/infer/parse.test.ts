import { describe, expect, it } from 'vitest';
import { JsonParseError, MAX_DEPTH, parseJson } from './parse';

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

  it('decodes escapes, including surrogate pairs', () => {
    expect(parseJson(String.raw`"a\"b\\c\/d\n\té😀"`)).toEqual({
      type: 'string',
      value: 'a"b\\c/d\n\té😀',
    });
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
    ['', 'Unexpected end of the input', 1, 1],
    ['{"a": 1,}', 'Trailing comma before }', 1, 9],
    ['[1, 2,]', 'Trailing comma before ]', 1, 7],
    ['{\n  "a": 1\n  "b": 2\n}', "Expected '}' or a comma after a property, found '\"'", 3, 3],
    ["{'a': 1}", "Expected a property name in quotes, found '''", 1, 2],
    ['{"a" 1}', "Expected ':' after a property name, found '1'", 1, 6],
    ['"abc', 'Unterminated string', 1, 1],
    ['"a\tb"', 'Control characters must be escaped in strings', 1, 3],
    [String.raw`"\x"`, String.raw`Invalid escape '\x'`, 1, 2],
    [String.raw`"\u12"`, String.raw`Invalid \u escape: expected four hex digits`, 1, 2],
    ['tru', "Unexpected 't'", 1, 1],
    ['01', "Unexpected '1' after the JSON value", 1, 2],
    ['1.', "Unexpected '.' after the JSON value", 1, 2],
    ['{} x', "Unexpected 'x' after the JSON value", 1, 4],
    ['NaN', "Unexpected 'N'", 1, 1],
  ])('reports %j with its position', (text, message, line, column) => {
    const error = errorOf(text);
    expect(error.message).toBe(`${message} (line ${String(line)}, column ${String(column)})`);
    expect([error.line, error.column]).toEqual([line, column]);
  });

  it('refuses nesting deep enough to exhaust the stack', () => {
    expect(() => parseJson('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH))).not.toThrow();
    const deep = '['.repeat(MAX_DEPTH + 2) + ']'.repeat(MAX_DEPTH + 2);
    expect(errorOf(deep).message).toMatch(/^Nested more than 500 levels deep/);
  });

  it('parses a megabyte quickly', () => {
    const big = JSON.stringify(
      Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `item ${String(i)}`, price: i / 7 })),
    );
    expect(big.length).toBeGreaterThan(500_000);
    const start = performance.now();
    parseJson(big);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
