import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_REMEMBERED,
  parseSettings,
  saveInput,
  saveSettings,
  type Settings,
} from './settings';

function memoryStorage(initial: Record<string, string> = {}, limit = Infinity) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
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
    expect(saveInput(storage, CUSTOM)).toBe(true);
    expect(loadSettings(storage)).toEqual(CUSTOM);
  });

  it('keeps the JSON apart from the options, and only when asked to', () => {
    const storage = memoryStorage();
    saveSettings(storage, CUSTOM);
    expect(storage.values.get('json2types:settings')).not.toContain('"a"');
    expect(saveInput(storage, { ...CUSTOM, rememberInput: false })).toBe(true);
    expect(storage.values.has('json2types:input')).toBe(false);
  });

  it('forgets the JSON when remembering is turned off', () => {
    const storage = memoryStorage({ 'json2types:input': 'secret' });
    saveInput(storage, { ...CUSTOM, rememberInput: false });
    expect(storage.values.has('json2types:input')).toBe(false);
  });

  it('keeps saving the options when the JSON is too large, and forgets the older JSON', () => {
    const storage = memoryStorage({ 'json2types:input': '{"old": "secret"}' }, 50_000);
    const large = { ...CUSTOM, input: `[${'1,'.repeat(40_000)}1]` };
    saveSettings(storage, large);
    expect(saveInput(storage, large)).toBe(false);
    expect(storage.values.has('json2types:input')).toBe(false);
    expect(loadSettings(storage)).toEqual({ ...CUSTOM, input: '' });
    expect(saveInput(memoryStorage(), { ...CUSTOM, input: 'x'.repeat(MAX_REMEMBERED + 1) })).toBe(false);
  });

  it('ignores a stored JSON whose remember flag is off', () => {
    const storage = memoryStorage({ 'json2types:input': 'secret' });
    saveSettings(storage, { ...CUSTOM, rememberInput: false });
    expect(loadSettings(storage).input).toBe('');
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
    expect(loadSettings(memoryStorage({ 'json2types:settings': '{not json' }))).toEqual(DEFAULT_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => {
      saveSettings(throwing, CUSTOM);
    }).not.toThrow();
    expect(saveInput(throwing, CUSTOM)).toBe(false);
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });
});
