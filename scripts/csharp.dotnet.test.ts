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

const SAMPLES: Record<string, string> = {
  order: JSON.stringify({
    id: 1042,
    order_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    placed_at: '2026-10-18T12:30:00.1234567+01:00',
    delivery_date: '2026-10-21',
    customer: { first_name: 'Ana', last_name: 'Silva', email: null, vip: true },
    lines: [
      { sku: 'A-1', quantity: 2, unit_price: 9.9, tags: ['gift'] },
      { sku: 'B-2', quantity: 1, unit_price: 120, discount: 0.15, tags: [] },
    ],
    total: 139.8,
    notes: null,
  }),
  list: JSON.stringify([
    { name: 'a', score: 1 },
    { name: 'b', score: 2.5, extra: { deep: [1, null, 3] } },
    { name: null, score: null },
  ]),
  // As text: JavaScript numbers would round the large ones.
  numbers: `{
    "small": [1, -2147483648, 2147483647],
    "long": [2147483648, -9223372036854775808],
    "huge": [123456789012345678901234567890, 1],
    "mixed": [1, 2.5, -3e5],
    "floating": [1e300, 2.5e-300],
    "exact": 79228162514264337593543950335
  }`,
  names: JSON.stringify({
    a: 1,
    A: 2,
    class: 'keyword',
    '1st': true,
    'first name': 'x',
    名前: 'name',
    'he said "hi"': 'quote',
    'back\\slash': 'b',
    'line break': 'l',
    '': 'empty',
    '😀': 'emoji',
    ToString: 'inherited',
    Equals: 'inherited',
    user: { user: 'self', User: 'clash' },
    system: { Newtonsoft: { json: 1 } },
    string: { value: 's' },
  }),
  arrays: JSON.stringify({
    matrix: [[1, 2], null, []],
    deep: [[[true]], [[false, null]]],
    nullable_items: [1, null, 3],
    empty: [],
    objects: [{ a: 1 }, { b: 'x' }, null],
    strings: [['a'], null],
  }),
  dates: JSON.stringify({
    zoned: ['2026-10-18T12:00:00Z', '2026-10-18T12:00:00+14:00'],
    local: ['2026-10-18T12:00:00', '2026-10-18T23:59:59.9999999'],
    mixed: ['2026-10-18T12:00:00Z', '2026-10-18T12:00:00', '2026-10-18'],
    days: ['2026-10-18', '0001-01-01', '9999-12-31'],
    ids: ['3F2504E0-4F89-11D3-9A0C-0305E82C3301'],
  }),
  scalar: '[1, 2, 3]',
  text: '"just a string"',
  nothing: 'null',
  rootList: '[[{"x": 1}], []]',
};

const COMBINATIONS: CSharpOptions[] = [];
for (const kind of ['class', 'record'] as const)
  for (const attributes of ['systemTextJson', 'newtonsoft', 'none'] as const)
    for (const nullable of [true, false])
      for (const collection of ['list', 'array'] as const)
        COMBINATIONS.push({ kind, attributes, nullable, collection });

const SERIALIZER = { systemTextJson: 'stj', newtonsoft: 'newtonsoft', none: 'none' } as const;

const work = mkdtempSync(join(tmpdir(), 'json2types-dotnet-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The type to deserialise the root as: the root declaration, or what the comment says. */
function rootType(code: string, rootName: string): string {
  const comment =
    /^\/\/ (?:Deserialise the JSON as|The JSON holds no objects: deserialise it as) (.+)\.$/m.exec(code);
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
function run(project: string, cases: Case[]): string {
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
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  };
  try {
    execFileSync('dotnet', ['build', '-nologo', '-v', 'quiet', '-clp:ErrorsOnly'], options);
    return execFileSync('dotnet', ['run', '--no-build'], options);
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`${project} failed:\n${stdout ?? ''}${stderr ?? ''}`, { cause: error });
  }
}

function makeCase(name: string, json: string, options: CSharpOptions, index: number): Case {
  const rootName = 'Root';
  const code = generateCSharp(inferModel(parseJson(json), { rootName }), options);
  const namespace = namespaceName(options.namespace ?? '');
  const usings = ['System', 'System.Collections.Generic', 'System.Numerics']
    .map((u) => `using ${u};`)
    .join('\n');
  const ns = namespace === '' ? '' : `namespace ${namespace};\n\n`;
  const serializer = SERIALIZER[options.attributes ?? 'systemTextJson'];
  // A verbatim string: only quotes need doubling.
  const literal = `@"${json.replaceAll('"', '""')}"`;
  const check =
    `${options.nullable === false ? '' : '#nullable enable\n\n'}${usings}\n\n${ns}` +
    `public static class Check${String(index)}\n{\n    public static void Run() =>\n` +
    `        JsonHarness.Harness.Verify<${rootType(code, rootName)}>(${JSON.stringify(name)}, "${serializer}", ${literal});\n}\n`;
  return {
    name,
    code,
    check,
    checkClass: namespace === '' ? `Check${String(index)}` : `${namespace}.Check${String(index)}`,
  };
}

describe('generated C#', () => {
  it('compiles without warnings and reads every sample back, with every option', () => {
    const cases: Case[] = [];
    for (const [sample, json] of Object.entries(SAMPLES)) {
      COMBINATIONS.forEach((options) => {
        const index = cases.length;
        const name = `${sample} ${options.kind ?? ''} ${options.attributes ?? ''} nullable=${String(options.nullable)} ${options.collection ?? ''}`;
        // Every case in its own namespace, so the same type names don't meet; some need fixing.
        const namespace = index % 3 === 0 ? `Cases.N${String(index)}` : `cases.${String(index)}th.class`;
        cases.push(makeCase(name, json, { ...options, namespace }, index));
      });
    }
    const output = run('namespaced', cases);
    expect(output).toContain(`${String(cases.length)} of ${String(cases.length)} cases read back intact`);
  });

  it.each(['systemTextJson', 'newtonsoft'] as const)(
    'compiles in the global namespace with %s',
    (attributes) => {
      const output = run(`global-${attributes}`, [
        makeCase(`names global ${attributes}`, SAMPLES.names, { attributes }, 0),
      ]);
      expect(output).toContain('1 of 1 cases read back intact');
    },
  );
});
