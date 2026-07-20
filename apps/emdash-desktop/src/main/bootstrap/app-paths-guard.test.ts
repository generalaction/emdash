import { afterAll, expect, it } from 'vitest';
import { assertUserDataConfigured, markUserDataConfigured } from './app-paths-guard';

const processWithType = process as NodeJS.Process & { type?: string };
const originalElectron = Object.getOwnPropertyDescriptor(process.versions, 'electron');
const originalType = Object.getOwnPropertyDescriptor(processWithType, 'type');

Object.defineProperty(process.versions, 'electron', {
  configurable: true,
  value: 'test',
});
Object.defineProperty(processWithType, 'type', {
  configurable: true,
  value: 'browser',
});

afterAll(() => {
  if (originalElectron) {
    Object.defineProperty(process.versions, 'electron', originalElectron);
  } else {
    Reflect.deleteProperty(process.versions, 'electron');
  }
  if (originalType) {
    Object.defineProperty(processWithType, 'type', originalType);
  } else {
    Reflect.deleteProperty(processWithType, 'type');
  }
});

it('fails before userData configuration and succeeds afterward', () => {
  expect(() => assertUserDataConfigured()).toThrow(
    'The database path was resolved before the Electron userData path was configured.'
  );
  markUserDataConfigured();
  expect(() => assertUserDataConfigured()).not.toThrow();
});
