/**
 * The whole conversion, JSON text in, code out: parse, infer, generate. Pure, so it runs the same
 * in the worker and, where workers aren't available, on the page.
 */
import { generateCSharp, type CSharpOptions } from '../generate/csharp';
import { generateTypeScript, type TypeScriptOptions } from '../generate/typescript';
import { inferModel, JsonParseError, parseJson, type Diagnostic } from '../infer';

export type Language = 'csharp' | 'typescript';

export interface ConvertRequest {
  readonly json: string;
  readonly language: Language;
  readonly rootName: string;
  readonly csharp: CSharpOptions;
  readonly typescript: TypeScriptOptions;
}

export type ConvertResult =
  | {
      readonly ok: true;
      readonly code: string;
      /** A file name for the download: the root type's name and the language's extension. */
      readonly fileName: string;
      readonly typeCount: number;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly message: string;
      /** Where the JSON stops being valid, for moving the caret there; absent for an empty input. */
      readonly offset: number | null;
    };

export function convert(request: ConvertRequest): ConvertResult {
  if (request.json.trim() === '') return { ok: false, message: 'Paste or type some JSON.', offset: null };
  try {
    const model = inferModel(parseJson(request.json), { rootName: request.rootName.trim() || 'Root' });
    const code =
      request.language === 'csharp'
        ? generateCSharp(model, request.csharp)
        : generateTypeScript(model, request.typescript);
    const name = model.declarations[0]?.name ?? 'Root';
    return {
      ok: true,
      code,
      fileName: `${name}.${request.language === 'csharp' ? 'cs' : 'ts'}`,
      typeCount: model.declarations.length,
      diagnostics: model.diagnostics,
    };
  } catch (error) {
    if (error instanceof JsonParseError) return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
}
