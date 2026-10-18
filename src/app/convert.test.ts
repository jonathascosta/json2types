import { describe, expect, it } from 'vitest';
import { convert, type ConvertRequest } from './convert';
import { DEFAULT_SETTINGS } from './settings';

const request = (json: string, changes: Partial<ConvertRequest> = {}): ConvertRequest => ({
  json,
  language: 'csharp',
  rootName: 'Root',
  csharp: DEFAULT_SETTINGS.csharp,
  typescript: DEFAULT_SETTINGS.typescript,
  ...changes,
});

describe('convert', () => {
  it('converts to C# with a .cs file named after the root type', () => {
    const result = convert(request('{"a": {"b": 1}}', { rootName: 'order' }));
    expect(result).toMatchObject({ ok: true, fileName: 'Order.cs', typeCount: 2, diagnostics: [] });
    expect(result.ok && result.code).toContain('public class Order\n');
  });

  it('converts to TypeScript with a .ts file', () => {
    const result = convert(request('[{"a": null}]', { language: 'typescript' }));
    expect(result).toMatchObject({ ok: true, fileName: 'Root.ts', typeCount: 1 });
    expect(result.ok && result.code).toContain('export interface Root {\n  a: unknown;\n}');
    expect(result.ok && result.diagnostics.map((d) => d.path)).toEqual(['$[*].a']);
  });

  it('passes the options through', () => {
    const csharp = convert(request('{"a": 1}', { csharp: { ...DEFAULT_SETTINGS.csharp, kind: 'record' } }));
    expect(csharp.ok && csharp.code).toContain('public record Root');
    const ts = convert(request('{"a": 1}', { language: 'typescript', typescript: { declaration: 'type' } }));
    expect(ts.ok && ts.code).toContain('export type Root = {');
  });

  it('falls back to Root for a blank root name', () => {
    expect(convert(request('{"a": 1}', { rootName: '  ' }))).toMatchObject({ fileName: 'Root.cs' });
  });

  it('names a file Root when there are no types', () => {
    expect(convert(request('[1, 2]'))).toMatchObject({ ok: true, fileName: 'Root.cs', typeCount: 0 });
  });

  it('reports a parse error with where it is', () => {
    expect(convert(request('{"a": 1,}'))).toEqual({
      ok: false,
      message: 'Trailing comma before } (line 1, column 8)',
      offset: 7,
    });
  });

  it('asks for JSON when there is none', () => {
    expect(convert(request(' \n'))).toEqual({ ok: false, message: 'Paste or type some JSON.', offset: null });
  });
});
