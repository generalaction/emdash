import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatHostProperties } from './host-styles';

describe('Chat UI host styling contract', () => {
  it('publishes neutral --chat-* properties without host Token mappings', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
    ) as {
      exports: Record<string, unknown>;
    };
    const contractSource = readFileSync(resolve(import.meta.dirname, 'host-styles.ts'), 'utf8');
    const themeSource = readFileSync(resolve(import.meta.dirname, 'styles/theme.css.ts'), 'utf8');
    const properties = Object.values(chatHostProperties);

    expect(packageJson.exports['./host-styles']).toEqual({
      import: './dist/host-styles.js',
      types: './dist/src/host-styles.d.ts',
    });
    expect(properties).toHaveLength(43);
    expect(new Set(properties).size).toBe(properties.length);
    expect(properties.every((property) => property.startsWith('--chat-'))).toBe(true);
    expect(contractSource).not.toContain('--em-');
    for (const property of properties) {
      expect(themeSource, property).toContain(`'${property.slice(2)}'`);
    }
  });
});
