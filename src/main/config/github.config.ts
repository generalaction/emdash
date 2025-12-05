/**
 * GitHub OAuth configuration for Device Flow authentication.
 * No client secret needed - Device Flow is designed for desktop/CLI apps.
 */
export const GITHUB_CONFIG = {
  clientId: 'Ov23ligC35uHWopzCeWf',
  scopes: ['repo', 'read:user', 'read:org'],
};
