import { tokens } from '@emdash/theme';
import { defineIntegrationManifest } from '../host';
import type { IntegrationValues } from '../host';

export const editorIntegration = defineIntegrationManifest('fixture-editor', {
  background: tokens.surface.current.background,
  foreground: tokens.foreground.default,
});

export type EditorIntegrationValues = IntegrationValues<typeof editorIntegration>;
