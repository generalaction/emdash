import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/shared/app-identity';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: R2_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  asarUnpack: [
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  // Ship the standalone `emdash-mcp` stdio bridge as an unpacked resource so
  // it can be spawned as a Node script by external MCP clients (Claude Code,
  // Cursor, Codex). Its in-app source lives at `bin/emdash-mcp.ts` and is
  // built to `out/main/emdash-mcp.js` by `electron.vite.config.ts`.
  // Resolved at runtime from the path emitted by `getBridgeCommand()` in
  // `src/main/core/mcp-server/service.ts`.
  extraResources: [
    {
      from: 'out/main/emdash-mcp.js',
      to: 'bin/emdash-mcp.js',
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/emdash/emdash-beta.icns',
    notarize: false,
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash-beta.icns',
  },
  linux: {
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/emdash/app-icon-beta.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    azureSignOptions: {
      publisherName: 'General Action, Inc.',
      endpoint: 'https://eus.codesigning.azure.net/',
      certificateProfileName: 'emdash-public',
      codeSigningAccountName: 'emdash',
    },
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
};

export default config;
