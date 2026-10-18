/**
 * What the page remembers between visits, in this browser only (localStorage): the language, the
 * options and, if asked to, the last JSON. Whatever is stored is checked field by field, so an old
 * or edited entry can never put the page in a state it doesn't expect.
 */
import type { CSharpOptions } from '../generate/csharp';
import type { TypeScriptOptions } from '../generate/typescript';
import type { Language } from './convert';

export interface Settings {
  language: Language;
  rootName: string;
  csharp: Required<CSharpOptions>;
  typescript: Required<TypeScriptOptions>;
  /** Keep the JSON too; off by default, since it may be private. */
  rememberInput: boolean;
  input: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'csharp',
  rootName: 'Root',
  csharp: { kind: 'class', attributes: 'systemTextJson', nullable: true, collection: 'list', namespace: '' },
  typescript: { declaration: 'interface', export: true, readonly: false },
  rememberInput: false,
  input: '',
};

const KEY = 'json2types:settings';

/** Long enough for any real name, short enough that a stored value can't bloat the page. */
const MAX_NAME = 200;

/** The stored settings, or the defaults for anything missing or invalid. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(storage?.getItem(KEY) ?? 'null');
  } catch {
    stored = null;
  }
  return parseSettings(stored);
}

/** Saves the settings; the JSON only if `rememberInput`. Storage may be full or blocked: ignored. */
export function saveSettings(storage: Pick<Storage, 'setItem'> | null, settings: Settings): void {
  const saved = settings.rememberInput ? settings : { ...settings, input: '' };
  try {
    storage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // A full or blocked storage only costs remembering.
  }
}

export function parseSettings(value: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const s = record(value);
  const cs = record(s.csharp);
  const ts = record(s.typescript);
  return {
    language: oneOf(s.language, ['csharp', 'typescript'], d.language),
    rootName: text(s.rootName, d.rootName),
    csharp: {
      kind: oneOf(cs.kind, ['class', 'record'], d.csharp.kind),
      attributes: oneOf(cs.attributes, ['systemTextJson', 'newtonsoft', 'none'], d.csharp.attributes),
      nullable: flag(cs.nullable, d.csharp.nullable),
      collection: oneOf(cs.collection, ['list', 'array'], d.csharp.collection),
      namespace: text(cs.namespace, d.csharp.namespace),
    },
    typescript: {
      declaration: oneOf(ts.declaration, ['interface', 'type'], d.typescript.declaration),
      export: flag(ts.export, d.typescript.export),
      readonly: flag(ts.readonly, d.typescript.readonly),
    },
    rememberInput: flag(s.rememberInput, d.rememberInput),
    input: flag(s.rememberInput, false) && typeof s.input === 'string' ? s.input : '',
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= MAX_NAME ? value : fallback;
}
