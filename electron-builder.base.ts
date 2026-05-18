import type { Configuration } from 'electron-builder';
import { injectLinuxRuntimeNodeModules } from './scripts/release/linux-runtime-node-modules';

interface IdentityConfig {
  appId: string;
  artifactPrefix: string;
  productName: string;
  r2BaseUrl: string;
  updateChannel: string;
  macIcon: string;
  winIcon: string;
}

export function createElectronBuilderConfig(identity: IdentityConfig): Configuration {
  return {
    appId: identity.appId,
    productName: identity.productName,
    directories: { output: 'release' },
    artifactName: `${identity.artifactPrefix}-\${arch}.\${ext}`,
    publish: [
      {
        provider: 'generic',
        url: identity.r2BaseUrl,
        channel: identity.updateChannel,
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
    afterPack: injectLinuxRuntimeNodeModules,
    mac: {
      category: 'public.app-category.developer-tools',
      hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: ['arm64'] },
      ],
      icon: identity.macIcon,
      notarize: false,
    },
    dmg: {
      icon: identity.macIcon,
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
      icon: identity.winIcon,
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
}
