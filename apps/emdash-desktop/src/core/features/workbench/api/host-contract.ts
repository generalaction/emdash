import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  ShortcutSettingsKey,
  TabNavigationDirection,
} from '@core/primitives/commands/api/shortcuts';
import type { OpenInAppId } from '@core/primitives/open-in-apps/api/open-in-apps';

export type DesktopHostEvent =
  | { type: 'menu-open-settings' }
  | { type: 'menu-check-for-updates' }
  | { type: 'menu-undo' }
  | { type: 'menu-redo' }
  | { type: 'menu-close-tab' }
  | { type: 'menu-quit-requested' }
  | { type: 'menu-give-feedback' }
  | { type: 'window-maximize-changed'; maximized: boolean }
  | { type: 'external-link-open-requested'; url: string }
  | {
      type: 'tab-navigation-shortcut';
      source: { kind: 'browser'; browserId: string };
      direction: TabNavigationDirection;
    }
  | {
      type: 'browser-app-shortcut';
      source: { kind: 'browser'; browserId: string };
      shortcutKey: ShortcutSettingsKey;
    }
  | {
      type: 'terminal-context-menu-action';
      requestId: string;
      action: 'paste' | 'select-all' | 'clear';
    };

type ActionResult = { success: boolean; error?: string };
type ReadResult = { success: true; content: string } | { success: false; error: string };
type RequiredPathResult = { success: true; path: string } | { success: false; error: string };
type NullablePathResult =
  | { success: true; path: string | null }
  | { success: false; error: string };
type OptionalPathResult =
  | { success: true; path: string | undefined }
  | { success: false; error: string };

export const desktopHostContract = defineContract({
  openExternal: procedure({
    input: z.object({ url: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  openPath: procedure({
    input: z.object({ path: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  showWorkspaceItemInFolder: procedure({
    input: z.object({ workspaceId: z.string(), relativePath: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  readUserFile: procedure({
    input: z.object({ path: z.string() }),
    output: z.custom<ReadResult>(),
  }),
  writeRendererLog: procedure({
    input: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      source: z.literal('renderer'),
      input: z.array(z.unknown()),
    }),
    output: z.void(),
  }),
  clipboardWriteText: procedure({
    input: z.object({ text: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  persistDroppedBlob: procedure({
    input: z.object({
      bytes: z.custom<Uint8Array>(),
      name: z.string().optional(),
      mimeType: z.string().optional(),
    }),
    output: z.custom<RequiredPathResult>(),
  }),
  persistClipboardImage: procedure({
    input: z.void(),
    output: z.custom<NullablePathResult>(),
  }),
  showTerminalContextMenu: procedure({
    input: z.object({
      requestId: z.string(),
      selectionText: z.string().nullable().optional(),
      linkText: z.string().nullable().optional(),
      x: z.number(),
      y: z.number(),
    }),
    output: z.custom<ActionResult>(),
  }),
  quit: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  openIn: procedure({
    input: z.object({
      app: z.custom<OpenInAppId>(),
      path: z.string(),
      isRemote: z.boolean().optional(),
      sshConnectionId: z.string().nullable().optional(),
    }),
    output: z.custom<ActionResult>(),
  }),
  checkInstalledApps: procedure({
    input: z.void(),
    output: z.record(z.string(), z.boolean()),
  }),
  listInstalledFonts: procedure({
    input: z.object({ refresh: z.boolean().optional() }),
    output: z.custom<{ success: boolean; fonts: string[]; cached: boolean; error?: string }>(),
  }),
  openSelectDirectoryDialog: procedure({
    input: z.object({ title: z.string(), message: z.string(), defaultPath: z.string().optional() }),
    output: z.string().optional(),
  }),
  openSelectAudioFileDialog: procedure({
    input: z.object({ title: z.string(), message: z.string() }),
    output: z.string().optional(),
  }),
  saveTextFile: procedure({
    input: z.object({ title: z.string(), defaultPath: z.string(), content: z.string() }),
    output: z.custom<OptionalPathResult>(),
  }),
  readAudioFileDataUrl: procedure({
    input: z.object({ filePath: z.string() }),
    output: z.custom<ActionResult & { dataUrl?: string }>(),
  }),
  minimizeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  toggleMaximizeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  closeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  isWindowMaximized: procedure({ input: z.void(), output: z.boolean() }),
  getAppVersion: procedure({ input: z.void(), output: z.string() }),
  getElectronVersion: procedure({ input: z.void(), output: z.string() }),
  getPlatform: procedure({ input: z.void(), output: z.custom<NodeJS.Platform>() }),
  getPlatformDisplayName: procedure({ input: z.void(), output: z.string() }),
  getDiagnosticLogAttachment: procedure({
    input: z.void(),
    output: z.object({
      filename: z.string(),
      mimeType: z.literal('text/plain'),
      content: z.string(),
    }),
  }),
  events: eventStream({ key: z.void(), event: z.custom<DesktopHostEvent>() }),
});
