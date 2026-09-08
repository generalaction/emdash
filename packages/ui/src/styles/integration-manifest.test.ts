import { tokens } from '@emdash/theme';
import { describe, expect, it } from 'vitest';
import { defineIntegrationManifest } from './host';

describe('imperative integration manifests', () => {
  it('generates one private assignment and read per declared vendor field', () => {
    const manifest = defineIntegrationManifest('fixture-editor', {
      'editor.background': tokens.surface.current.background,
      cursorAccent: tokens.foreground.inverse,
    });
    const reads = new Map<string, number>();

    expect(manifest.properties).toEqual({
      'editor.background': '--emdash-integration-fixture-editor-editor-background',
      cursorAccent: '--emdash-integration-fixture-editor-cursor-accent',
    });
    expect(manifest.writer.vars).toEqual({
      '--emdash-integration-fixture-editor-editor-background': tokens.surface.current.background,
      '--emdash-integration-fixture-editor-cursor-accent': tokens.foreground.inverse,
    });
    expect(
      manifest.read({
        getPropertyValue(property) {
          reads.set(property, (reads.get(property) ?? 0) + 1);
          return property.endsWith('background') ? ' white ' : ' black ';
        },
      })
    ).toEqual({
      'editor.background': 'white',
      cursorAccent: 'black',
    });
    expect(reads).toEqual(
      new Map([
        ['--emdash-integration-fixture-editor-editor-background', 1],
        ['--emdash-integration-fixture-editor-cursor-accent', 1],
      ])
    );
  });
});
