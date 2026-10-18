/**
 * Compiles the generated C# with the .NET SDK, warnings as errors, and reads each sample back with
 * it (scripts/dotnet/Harness.cs). Slow and needs `dotnet`, so it runs on its own: npm run test:dotnet.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateCSharp, namespaceName, type CSharpOptions } from '../src/generate/csharp';
import { inferModel, parseJson } from '../src/infer';
import { SAMPLES } from './samples';

const COMBINATIONS: CSharpOptions[] = [];
for (const kind of ['class', 'record'] as const)
  for (const attributes of ['systemTextJson', 'newtonsoft', 'none'] as const)
    for (const nullable of [true, false])
      for (const collection of ['list', 'array'] as const)
        COMBINATIONS.push({ kind, attributes, nullable, collection });

/** Samples whose names need no attributes: without them, these are still compared. */
const EXACT_NAMES = new Set(['pascal', 'scalar', 'text', 'nothing']);

/** How Harness.Verify reads a case: "read" only checks that System.Text.Json reads it. */
function serializer(sample: string, attributes: CSharpOptions['attributes']): string {
  if (attributes === 'newtonsoft') return 'newtonsoft';
  return attributes === 'none' && !EXACT_NAMES.has(sample) ? 'read' : 'stj';
}

const work = mkdtempSync(join(tmpdir(), 'json2types-dotnet-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The type to deserialise the root as: the root declaration, or what the comment says. */
function rootType(code: string, rootName: string): string {
  const comment = /^\/\/ .*deserialise the JSON as (.+)\.$/im.exec(code);
  return comment?.[1] ?? rootName;
}

interface Case {
  name: string;
  code: string;
  check: string;
  /** The check's class, with its namespace. */
  checkClass: string;
}

/**
 * Builds one project from the cases and runs it. A case's check sits in a file of its own, in the
 * case's namespace, so the generated file compiles with its own usings only.
 */
function run(project: string, cases: Case[], projectDefaults = false): string {
  const dir = join(work, project);
  mkdirSync(dir, { recursive: true });
  for (const file of ['Harness.csproj', 'Harness.cs'])
    copyFileSync(join(import.meta.dirname, 'dotnet', file), join(dir, file));
  cases.forEach((c, i) => {
    writeFileSync(join(dir, `Case${String(i)}.cs`), c.code);
    writeFileSync(join(dir, `Check${String(i)}.cs`), c.check);
  });
  const calls = cases.map((c) => `        global::${c.checkClass}.Run();`).join('\n');
  writeFileSync(
    join(dir, 'Program.cs'),
    `public static class Program\n{\n    public static int Main()\n    {\n${calls}\n        return JsonHarness.Harness.Report();\n    }\n}\n`,
  );
  const options = {
    cwd: dir,
    encoding: 'utf8' as const,
    // Away from UTC, so values read as local time are told apart from UTC ones.
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', TZ: 'America/Sao_Paulo' },
  };
  // What `dotnet new` turns on, where most generated code ends up.
  const defaults = projectDefaults ? ['-p:Nullable=enable', '-p:ImplicitUsings=enable'] : [];
  try {
    execFileSync('dotnet', ['build', '-nologo', '-v', 'quiet', '-clp:ErrorsOnly', ...defaults], options);
    return execFileSync('dotnet', ['run', '--no-build'], options);
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`${project} failed:\n${stdout ?? ''}${stderr ?? ''}`, { cause: error });
  }
}

function makeCase(name: string, json: string, options: CSharpOptions, index: number, reader: string): Case {
  const rootName = 'Root';
  const code = generateCSharp(inferModel(parseJson(json), { rootName }), options);
  const namespace = namespaceName(options.namespace ?? '');
  const usings = ['System', 'System.Collections.Generic', 'System.Numerics']
    .map((u) => `using ${u};`)
    .join('\n');
  const ns = namespace === '' ? '' : `namespace ${namespace};\n\n`;
  // A verbatim string: only quotes need doubling.
  const literal = `@"${json.replaceAll('"', '""')}"`;
  const check =
    `${options.nullable === false ? '' : '#nullable enable\n\n'}${usings}\n\n${ns}` +
    `public static class Check${String(index)}\n{\n    public static void Run() =>\n` +
    `        JsonHarness.Harness.Verify<${rootType(code, rootName)}>(${JSON.stringify(name)}, "${reader}", ${literal});\n}\n`;
  return {
    name,
    code,
    check,
    checkClass: namespace === '' ? `Check${String(index)}` : `${namespace}.Check${String(index)}`,
  };
}

function matrix(): Case[] {
  const cases: Case[] = [];
  const add = (sample: string, json: string, options: CSharpOptions, reader: string) => {
    const index = cases.length;
    const name = `${sample} ${options.kind ?? ''} ${options.attributes ?? ''} nullable=${String(options.nullable)} ${options.collection ?? ''} ${reader}`;
    // Every case in its own namespace, so the same type names don't meet; some need fixing.
    const namespace = index % 3 === 0 ? `Cases.N${String(index)}` : `cases.${String(index)}th.class`;
    cases.push(makeCase(name, json, { ...options, namespace }, index, reader));
  };
  for (const [sample, json] of Object.entries(SAMPLES)) {
    for (const options of COMBINATIONS) {
      add(sample, json, options, serializer(sample, options.attributes));
      // Output without attributes is for either serializer.
      if (options.attributes === 'none' && sample === 'pascal') add(sample, json, options, 'newtonsoft');
    }
  }
  return cases;
}

describe('generated C#', () => {
  it.each([
    ['nullable and implicit usings off', false],
    ['the defaults of dotnet new', true],
  ])('compiles without warnings and reads every sample back, with every option, with %s', (_, defaults) => {
    const cases = matrix();
    const output = run(defaults ? 'defaults' : 'strict', cases, defaults);
    expect(output).toContain(`${String(cases.length)} of ${String(cases.length)} cases read back intact`);
  });

  it.each(['systemTextJson', 'newtonsoft'] as const)(
    'compiles in the global namespace with %s',
    (attributes) => {
      const output = run(`global-${attributes}`, [
        makeCase(
          `names global ${attributes}`,
          SAMPLES.names,
          { attributes },
          0,
          serializer('names', attributes),
        ),
      ]);
      expect(output).toContain('1 of 1 cases read back intact');
    },
  );
});
