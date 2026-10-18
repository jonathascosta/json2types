import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings, type Settings } from './settings';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_: string, next: string) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

const CUSTOM: Settings = {
  language: 'typescript',
  rootName: 'Order',
  csharp: {
    kind: 'record',
    attributes: 'newtonsoft',
    nullable: false,
    collection: 'array',
    namespace: 'Shop',
  },
  typescript: { declaration: 'type', export: false, readonly: true },
  rememberInput: true,
  input: '{"a": 1}',
};

describe('settings', () => {
  it('starts from the defaults', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and loads every setting', () => {
    const storage = memoryStorage();
    saveSettings(storage, CUSTOM);
    expect(loadSettings(storage)).toEqual(CUSTOM);
  });

  it('keeps the JSON only when asked to', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...CUSTOM, rememberInput: false });
    expect(storage.value).not.toContain('"a"');
    expect(loadSettings(storage).input).toBe('');
  });

  it('ignores a stored JSON whose remember flag is off', () => {
    expect(parseSettings({ rememberInput: false, input: 'secret' }).input).toBe('');
  });

  it('replaces anything invalid with its default, field by field', () => {
    const parsed = parseSettings({
      language: 'cobol',
      rootName: 'x'.repeat(201),
      csharp: { kind: 'struct', attributes: 'yes', nullable: 'true', collection: 'list', namespace: 7 },
      typescript: null,
      rememberInput: 1,
    });
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      csharp: { ...DEFAULT_SETTINGS.csharp, collection: 'list' },
    });
  });

  it('survives storage that is broken, full or blocked', () => {
    expect(loadSettings(memoryStorage('{not json'))).toEqual(DEFAULT_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => {
      saveSettings(throwing, CUSTOM);
    }).not.toThrow();
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });
});
