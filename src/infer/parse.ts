/**
 * A JSON parser that keeps what JSON.parse throws away: the text of every number, so `10.0` is
 * known to be a decimal and `9007199254740993` keeps all its digits, and the line and column of
 * every error.
 */

export type JsonValue =
  | { readonly type: 'object'; readonly entries: readonly JsonEntry[] }
  | { readonly type: 'array'; readonly items: readonly JsonValue[] }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly raw: string }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'null' };

export interface JsonEntry {
  readonly key: string;
  readonly value: JsonValue;
}

export class JsonParseError extends Error {
  constructor(
    message: string,
    /** 1-based. */
    readonly line: number,
    /** 1-based, in UTF-16 code units. */
    readonly column: number,
    /** 0-based offset into the text. */
    readonly offset: number,
  ) {
    super(`${message} (line ${String(line)}, column ${String(column)})`);
    this.name = 'JsonParseError';
  }
}

/** How many levels arrays and objects may nest (the outermost is level 1), to keep the stack safe. */
export const MAX_DEPTH = 500;

const ESCAPES = new Map(
  Object.entries({
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  }),
);

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseJson(text: string): JsonValue {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string, at = pos): never => {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < at; i++) {
      const c = text.charCodeAt(i);
      // \n, \r\n and a lone \r each end a line.
      if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
        line++;
        lineStart = i + 1;
      }
    }
    // A byte order mark isn't a column anyone sees.
    const bom = line === 1 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
    throw new JsonParseError(message, line, at - lineStart + 1 - bom, at);
  };

  const describe = (at: number): string => {
    const code = text.codePointAt(at);
    if (code === undefined) return 'the end of the input';
    const char = String.fromCodePoint(code);
    // Invisible characters, and the quote itself, by their code point, so "found ' '" never hides a
    // non-breaking space and "found '''" never happens.
    if (/[\s\p{C}\p{Z}']/u.test(char)) {
      return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    }
    return `'${char}'`;
  };

  const skipWhitespace = (): void => {
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) break;
      pos++;
    }
  };

  const expectChar = (char: string, context: string): void => {
    if (text[pos] !== char) fail(`Expected '${char}' ${context}, found ${describe(pos)}`);
    pos++;
  };

  const parseString = (): string => {
    const start = pos;
    pos++; // opening quote
    let result = '';
    let chunkStart = pos;
    for (;;) {
      if (pos >= text.length) fail('Unterminated string', start);
      const c = text.charCodeAt(pos);
      if (c === 0x22) {
        result += text.slice(chunkStart, pos);
        pos++;
        return result;
      }
      if (c < 0x20) fail('Control characters must be escaped in strings');
      if (c !== 0x5c) {
        pos++;
        continue;
      }
      result += text.slice(chunkStart, pos);
      if (pos + 1 >= text.length) fail('Unterminated string', start);
      const escape = text[pos + 1] ?? '';
      if (escape === 'u') {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape: expected four hex digits');
        result += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
      } else {
        const char = ESCAPES.get(escape);
        if (char === undefined) return fail(`Invalid escape '\\${escape}'`);
        result += char;
        pos += 2;
      }
      chunkStart = pos;
    }
  };

  const parseValue = (depth: number): JsonValue => {
    skipWhitespace();
    const char = text[pos];
    if ((char === '{' || char === '[') && depth >= MAX_DEPTH) {
      fail(`Nested more than ${String(MAX_DEPTH)} levels deep`);
    }
    switch (char) {
      case '{': {
        pos++;
        const entries: JsonEntry[] = [];
        skipWhitespace();
        if (text[pos] === '}') {
          pos++;
          return { type: 'object', entries };
        }
        for (;;) {
          skipWhitespace();
          if (text[pos] !== '"') fail(`Expected a property name in quotes, found ${describe(pos)}`);
          const key = parseString();
          skipWhitespace();
          expectChar(':', 'after a property name');
          entries.push({ key, value: parseValue(depth + 1) });
          skipWhitespace();
          if (text[pos] === ',') {
            pos++;
            skipWhitespace();
            if (text[pos] === '}') fail('Trailing comma before }');
            continue;
          }
          expectChar('}', 'or a comma after a property');
          return { type: 'object', entries };
        }
      }
      case '[': {
        pos++;
        const items: JsonValue[] = [];
        skipWhitespace();
        if (text[pos] === ']') {
          pos++;
          return { type: 'array', items };
        }
        for (;;) {
          items.push(parseValue(depth + 1));
          skipWhitespace();
          if (text[pos] === ',') {
            pos++;
            skipWhitespace();
            if (text[pos] === ']') fail('Trailing comma before ]');
            continue;
          }
          expectChar(']', 'or a comma after an array item');
          return { type: 'array', items };
        }
      }
      case '"':
        return { type: 'string', value: parseString() };
      case 't':
      case 'f':
      case 'n': {
        for (const [word, value] of [
          ['true', { type: 'boolean', value: true }],
          ['false', { type: 'boolean', value: false }],
          ['null', { type: 'null' }],
        ] as const) {
          if (text.startsWith(word, pos)) {
            pos += word.length;
            return value;
          }
        }
        return fail('Invalid literal: expected true, false or null');
      }
      default: {
        NUMBER.lastIndex = pos;
        const match = NUMBER.exec(text);
        if (!match) {
          if (char === '-') return fail('Invalid number');
          return fail(pos >= text.length ? 'Unexpected end of the input' : `Unexpected ${describe(pos)}`);
        }
        pos += match[0].length;
        // A number cut short or run on (01, 1., 1e, 1.5.2) is one bad number, not two tokens.
        if (/[\d.eE+-]/.test(text[pos] ?? '')) fail('Invalid number', pos - match[0].length);
        return { type: 'number', raw: match[0] };
      }
    }
  };

  const value = parseValue(0);
  skipWhitespace();
  if (pos < text.length) fail(`Unexpected ${describe(pos)} after the JSON value`);
  return value;
}
