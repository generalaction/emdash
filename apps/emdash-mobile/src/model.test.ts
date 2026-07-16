import { describe, expect, it } from 'vitest';
import {
  categoryForKind,
  formatFileSize,
  isTaskSelectable,
  normalizePairingCode,
  validateResourceTitle,
  validPairingCode,
} from './model';

describe('mobile view model', () => {
  it('maps runtime resource kinds into navigator categories', () => {
    expect(categoryForKind('acp')).toBe('conversations');
    expect(categoryForKind('agent-terminal')).toBe('conversations');
    expect(categoryForKind('terminal')).toBe('terminals');
    expect(categoryForKind('file')).toBe('files');
    expect(categoryForKind('diff')).toBe('changes');
    expect(categoryForKind('browser')).toBe('browser');
  });

  it('allows ready and dormant tasks to be opened', () => {
    expect(isTaskSelectable({ status: 'ready' })).toBe(true);
    expect(isTaskSelectable({ status: 'dormant' })).toBe(true);
    expect(isTaskSelectable({ status: 'provisioning' })).toBe(false);
    expect(isTaskSelectable({ status: 'unavailable' })).toBe(false);
  });

  it('normalizes the pairing code without retaining arbitrary input', () => {
    expect(normalizePairingCode('12 34-56ab78-90')).toBe('12345678');
    expect(validPairingCode('12345678')).toBe(true);
    expect(validPairingCode('1234')).toBe(false);
  });

  it('validates rename limits', () => {
    expect(validateResourceTitle('   ')).toBe('Enter a name.');
    expect(validateResourceTitle('Mobile chat')).toBeNull();
    expect(validateResourceTitle('x'.repeat(101))).toMatch('100');
  });

  it('formats bounded resource sizes', () => {
    expect(formatFileSize(672)).toBe('672 B');
    expect(formatFileSize(38_912)).toBe('38 KB');
    expect(formatFileSize(2_621_440)).toBe('2.5 MB');
  });
});
