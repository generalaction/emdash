/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { monacoThemeIntegration } from '@core/features/editor/browser/monaco/monaco-theme-integration';
import { readMonacoThemeColors } from '@core/features/editor/browser/monaco/monaco-themes';
import { readXtermTheme } from '@core/features/terminals/browser/pty/xterm-theme';
import { xtermThemeIntegration } from '@core/features/terminals/browser/pty/xterm-theme-integration';

const MONACO_FIELDS = [
  'editor.background',
  'editor.foreground',
  'editor.lineHighlightBackground',
  'editorLineNumber.foreground',
  'editorGutter.background',
  'diffEditor.insertedTextBackground',
  'diffEditor.insertedLineBackground',
  'diffEditor.insertedTextBorder',
  'diffEditor.removedTextBackground',
  'diffEditor.removedLineBackground',
  'diffEditor.removedTextBorder',
  'diffEditor.unchangedRegionBackground',
  'diffEditor.border',
  'diffEditor.diagonalFill',
  'editor.selectionBackground',
  'editor.selectionForeground',
  'editor.inactiveSelectionBackground',
] as const;

const XTERM_FIELDS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
] as const;

type CheckedManifest = {
  readonly fields: Readonly<Record<string, string>>;
  readonly properties: Readonly<Record<string, string>>;
  readonly writer: {
    readonly vars: Readonly<Record<string, string>>;
  };
  read(style: { getPropertyValue(property: string): string }): Readonly<Record<string, string>>;
};

function expectCompleteFieldCoverage(
  manifest: CheckedManifest,
  expectedFields: readonly string[]
): void {
  expect(Object.keys(manifest.fields)).toEqual(expectedFields);
  expect(Object.keys(manifest.properties)).toEqual(expectedFields);

  const propertyNames = Object.values(manifest.properties);
  const reads = new Map<string, number>();
  const values = manifest.read({
    getPropertyValue(property) {
      reads.set(property, (reads.get(property) ?? 0) + 1);
      return ` ${property} `;
    },
  });

  expect(new Set(propertyNames).size).toBe(expectedFields.length);
  expect(Object.keys(manifest.writer.vars)).toHaveLength(expectedFields.length);
  for (const field of expectedFields) {
    const property = manifest.properties[field];
    expect(property).toMatch(/^--emdash-integration-[a-z0-9-]+$/);
    expect(manifest.fields[field]).toMatch(/^var\(--em-[a-z0-9-]+\)$/);
    expect(manifest.writer.vars[property]).toBe(manifest.fields[field]);
    expect(values[field]).toBe(property);
    expect(reads.get(property)).toBe(1);
  }
}

function expectResolvedThemeChange(manifest: CheckedManifest): void {
  const tokens = [...new Set(Object.values(manifest.fields))];
  const themes = {
    light: new Map(tokens.map((token, index) => [token, `light-${index}`])),
    dark: new Map(tokens.map((token, index) => [token, `dark-${index}`])),
  };
  let resolvedTheme: keyof typeof themes = 'light';
  const style = {
    getPropertyValue(property: string) {
      const token = manifest.writer.vars[property];
      return themes[resolvedTheme].get(token) ?? '';
    },
  };

  const light = manifest.read(style);
  resolvedTheme = 'dark';
  const dark = manifest.read(style);

  for (const field of Object.keys(manifest.fields)) {
    const token = manifest.fields[field];
    expect(light[field]).toBe(themes.light.get(token));
    expect(dark[field]).toBe(themes.dark.get(token));
    expect(dark[field]).not.toBe(light[field]);
  }
}

function integrationStyle(
  manifest: CheckedManifest,
  values: readonly string[]
): { getPropertyValue(property: string): string } {
  const valuesByProperty = new Map(
    Object.values(manifest.properties).map((property, index) => [property, values[index] ?? ''])
  );
  return {
    getPropertyValue(property) {
      return valuesByProperty.get(property) ?? '';
    },
  };
}

describe('desktop imperative Theme integrations', () => {
  it('covers every Monaco field with a private property, writer, reader, and Theme mapping', () => {
    expectCompleteFieldCoverage(monacoThemeIntegration, MONACO_FIELDS);
  });

  it('covers every Xterm field with a private property, writer, reader, and Theme mapping', () => {
    expectCompleteFieldCoverage(xtermThemeIntegration, XTERM_FIELDS);
  });

  it('re-reads Monaco and Xterm values when the resolved Theme changes', () => {
    expectResolvedThemeChange(monacoThemeIntegration);
    expectResolvedThemeChange(xtermThemeIntegration);
  });

  it('drives the active Monaco and Xterm readers through the manifest contracts', () => {
    const monacoValues = MONACO_FIELDS.map(
      (_, index) => `#${(index + 1).toString(16).padStart(6, '0')}`
    );
    const xtermValues = XTERM_FIELDS.map(
      (_, index) => `#${(index + 101).toString(16).padStart(6, '0')}`
    );

    expect(readMonacoThemeColors(integrationStyle(monacoThemeIntegration, monacoValues))).toEqual(
      Object.fromEntries(MONACO_FIELDS.map((field, index) => [field, monacoValues[index]]))
    );
    expect(readXtermTheme(integrationStyle(xtermThemeIntegration, xtermValues))).toEqual(
      Object.fromEntries(XTERM_FIELDS.map((field, index) => [field, xtermValues[index]]))
    );
  });
});
