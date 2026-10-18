import { describe, expect, it } from 'vitest';
import { versionLabel } from './version';

describe('versionLabel', () => {
  it('prefixes the version with v', () => {
    expect(versionLabel('0.1.0')).toBe('v0.1.0');
  });
});
