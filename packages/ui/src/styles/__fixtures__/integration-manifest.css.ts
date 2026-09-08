import { tokens } from '@emdash/theme';
import { defineIntegrationManifest, hostStyle } from '../host';

const editorIntegration = defineIntegrationManifest('fixture-editor', {
  'editor.background': tokens.surface.current.background,
  cursorAccent: tokens.foreground.inverse,
});

export const integrationRoot = hostStyle(editorIntegration.writer);
