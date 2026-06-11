import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  APP_NAME_LOWER,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/shared/app-identity.canary.ts';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'github',
      owner: 'generalaction',
      repo: 'emdash',
      releaseType: 'draft',
      // 'canary' must match the prerelease identifier in scripts/release/lib/version.ts
      // (e.g. 1.1.33-canary.42 -> prerelease id "canary"). electron-updater uses this
      // id to select the matching release from the Atom feed and to construct the
      // channel filename (canary*.yml) it fetches from GitHub.
      channel: 'canary',
    },
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
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/emdash/emdash-canary.icns',
    notarize: false,
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash-canary.icns',
    background: 'build/dmg-background.tiff',
    window: { width: 530, height: 319 },
    contents: [
      { x: 132, y: 150, type: 'file' },
      { x: 398, y: 150, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    category: 'Development',
    executableName: APP_NAME_LOWER,
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  deb: {
    packageName: APP_NAME_LOWER,
  },
  rpm: {
    packageName: APP_NAME_LOWER,
  },
  win: {
    icon: 'src/assets/images/emdash/app-icon-canary.png',
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
