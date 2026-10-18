/**
 * Type-checks the generated TypeScript with the TypeScript compiler, strict, against each sample:
 * the sample, written as a literal, must be assignable to the root type, so a missing property, a
 * wrong type or a missing `| null` fails the check.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateTypeScript, type TypeScriptOptions } from '../src/generate/typescript';
import { inferModel, parseJson } from '../src/infer';
import { SAMPLES } from './samples';

const COMBINATIONS: TypeScriptOptions[] = [];
for (const declaration of ['interface', 'type'] as const)
  for (const exported of [true, false])
    for (const readonly of [true, false]) COMBINATIONS.push({ declaration, export: exported, readonly });

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  // With the DOM's globals, which a generated type must not merge with.
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  noEmit: true,
  skipLibCheck: true,
};

/** The type to check the sample against: the root declaration, or what the comment says. */
function rootType(code: string): string {
  return /^\/\/ .*parse the JSON as (.+)\.$/im.exec(code)?.[1] ?? 'Root';
}

/** Each case's file: the generated code, then the sample assigned to its root type. */
function caseFile(code: string, json: string): string {
  // Output with no declarations is no module; this keeps each file's `sample` to itself.
  const module = /^(export |interface |type )/m.test(code) ? '' : 'export {};\n';
  return `${code}\nconst sample: ${rootType(code)} = ${json};\nvoid sample;\n${module}`;
}

/** The compiler's errors for a set of in-memory files, as text. */
function typeCheck(files: Map<string, string>): string[] {
  const host = ts.createCompilerHost(OPTIONS);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.fileExists = (name) => files.has(name) || fileExists(name);
  host.getSourceFile = (name, version) => {
    const text = files.get(name);
    return text === undefined ? getSourceFile(name, version) : ts.createSourceFile(name, text, version);
  };
  const program = ts.createProgram([...files.keys()], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    const position = where ? `${d.file?.fileName ?? ''}:${String(where.line + 1)}` : '';
    return `${position} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

describe('generated TypeScript', () => {
  it('type-checks every sample against its types, with every option', () => {
    const files = new Map<string, string>();
    for (const [sample, json] of Object.entries(SAMPLES)) {
      const model = inferModel(parseJson(json));
      COMBINATIONS.forEach((options, i) => {
        files.set(`/cases/${sample}-${String(i)}.ts`, caseFile(generateTypeScript(model, options), json));
      });
    }
    expect(typeCheck(files)).toEqual([]);
  });

  it('fails when the sample does not fit the types', () => {
    const code = generateTypeScript(inferModel(parseJson('{"a": 1, "b": [1]}')));
    expect(typeCheck(new Map([['/bad.ts', caseFile(code, '{"a": null, "b": [1]}')]]))).not.toEqual([]);
    expect(typeCheck(new Map([['/bad.ts', caseFile(code, '{"a": 1}')]]))).not.toEqual([]);
    expect(typeCheck(new Map([['/bad.ts', caseFile(code, '{"a": 1, "b": [1], "c": 2}')]]))).not.toEqual([]);
    expect(typeCheck(new Map([['/bad.ts', caseFile(code, '{"a": "1", "b": [1]}')]]))).not.toEqual([]);
  });
});
