import { describe, expect, it } from 'vitest';
import { validateEnvEntries } from './agent-settings-env';

describe('validateEnvEntries', () => {
  it('accepts empty rows and valid environment variable keys', () => {
    expect(
      validateEnvEntries([
        { key: '', value: '' },
        { key: 'OPENAI_API_KEY', value: 'key' },
        { key: '_PRIVATE_1', value: 'value' },
      ])
    ).toEqual(['', '', '']);
  });

  it('rejects values without keys', () => {
    expect(validateEnvEntries([{ key: '', value: 'value' }])).toEqual([
      'Key is required when a value is set.',
    ]);
  });

  it('rejects invalid key characters and leading numbers', () => {
    expect(
      validateEnvEntries([
        { key: 'OPENAI-KEY', value: 'value' },
        { key: '1_OPENAI_KEY', value: 'value' },
      ])
    ).toEqual([
      'Use letters, numbers, and underscores. The first character cannot be a number.',
      'Use letters, numbers, and underscores. The first character cannot be a number.',
    ]);
  });

  it('rejects duplicate valid keys after trimming', () => {
    expect(
      validateEnvEntries([
        { key: 'OPENAI_API_KEY', value: 'first' },
        { key: ' OPENAI_API_KEY ', value: 'second' },
      ])
    ).toEqual(['Duplicate environment variable key.', 'Duplicate environment variable key.']);
  });
});
