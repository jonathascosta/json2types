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

interface Problem {
  file: string;
  line: number;
  code: number;
  message: string;
}

/** The compiler's errors for a set of in-memory files, in one program. */
function typeCheck(files: Map<string, string>): Problem[] {
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
  return ts.getPreEmitDiagnostics(program).map((d) => ({
    file: d.file?.fileName ?? '',
    line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
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
    expect(
      typeCheck(files).map((p) => `${p.file}:${String(p.line)} TS${String(p.code)} ${p.message}`),
    ).toEqual([]);
  });

  it('fails, on the sample, when the sample does not fit the types, with every option', () => {
    const code = (options: TypeScriptOptions) =>
      generateTypeScript(inferModel(parseJson('{"a": 1, "b": [{"c": "x", "d": [1, null]}]}')), options);
    // Each wrong sample, with the error tsc must report for it.
    const wrong: [string, number][] = [
      ['{"a": null, "b": []}', 2322], // null where it never was
      ['{"b": []}', 2741], // a property missing
      ['{"a": 1, "b": [], "e": 2}', 2353], // a property never seen
      ['{"a": "1", "b": []}', 2322], // the wrong kind
      ['{"a": 1, "b": [{"c": "x", "d": [], "e": 1}]}', 2353], // never seen, inside an array item
      ['{"a": 1, "b": [{"c": 1, "d": []}]}', 2322], // the wrong kind, inside an array item
      ['{"a": 1, "b": [{"c": "x", "d": ["1"]}]}', 2322], // the wrong kind of array item
      ['{"a": 1, "b": [null]}', 2322], // a null item where there never was one
    ];
    const files = new Map<string, string>();
    COMBINATIONS.forEach((options, i) => {
      wrong.forEach(([json], j) =>
        files.set(`/wrong/${String(i)}-${String(j)}.ts`, caseFile(code(options), json)),
      );
    });
    const problems = typeCheck(files);
    for (const [file, text] of files) {
      const expected = wrong[Number(/-(\d+)\.ts$/.exec(file)?.[1])]?.[1];
      const sampleLine = text.split('\n').findIndex((l) => l.startsWith('const sample')) + 1;
      const found = problems.filter((p) => p.file === file);
      expect(
        found.map((p) => [p.line, p.code]),
        file,
      ).toEqual([[sampleLine, expected]]);
    }
  });
});
