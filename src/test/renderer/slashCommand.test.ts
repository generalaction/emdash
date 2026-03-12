import { describe, expect, it } from 'vitest';
import { isSlashCommandInput } from '../../renderer/lib/slashCommand';

describe('isSlashCommandInput', () => {
  it('returns true for standard slash commands', () => {
    expect(isSlashCommandInput('/help')).toBe(true);
    expect(isSlashCommandInput('   /model gpt-5')).toBe(true);
  });

  it('returns false for normal natural-language input', () => {
    expect(isSlashCommandInput('Fix the auth flow')).toBe(false);
  });

  it('returns false for slash inside sentence-like input', () => {
    expect(isSlashCommandInput('look at src/renderer')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isSlashCommandInput('   ')).toBe(false);
  });

  it('returns false for file-path-like input with extensions or dots', () => {
    expect(isSlashCommandInput('a/file.ts')).toBe(false);
    expect(isSlashCommandInput('x/.env')).toBe(false);
    expect(isSlashCommandInput('a/b')).toBe(false);
    expect(isSlashCommandInput('1/test')).toBe(false);
  });

  it('returns true for valid TUI prefix slash commands', () => {
    expect(isSlashCommandInput('i/model')).toBe(true);
    expect(isSlashCommandInput('n/help')).toBe(true);
    expect(isSlashCommandInput('i/set-model')).toBe(true);
  });
});
