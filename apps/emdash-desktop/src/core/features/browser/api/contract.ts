import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  BrowserDataClearKind,
  BrowserEvent,
  BrowsingDataKind,
} from '@core/primitives/browser/api';

type BrowserActionResult = { success: boolean; error?: string };

export const browserContract = defineContract({
  registerSession: procedure({
    input: z.object({ browserId: z.string(), partition: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  unregisterSession: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  bindWebContents: procedure({
    input: z.object({ browserId: z.string(), webContentsId: z.number() }),
    output: z.custom<BrowserActionResult>(),
  }),
  setActiveBrowser: procedure({
    input: z.object({ browserId: z.string().nullable() }),
    output: z.custom<BrowserActionResult>(),
  }),
  getActiveBrowser: procedure({
    input: z.void(),
    output: z.object({ browserId: z.string().nullable() }),
  }),
  openDevTools: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  captureScreenshot: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearData: procedure({
    input: z.object({ browserId: z.string(), kind: z.custom<BrowserDataClearKind>() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearProfileStorage: procedure({
    input: z.object({ profileId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearBrowsingData: procedure({
    input: z.object({ kind: z.custom<BrowsingDataKind>() }),
    output: z.custom<BrowserActionResult>(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<BrowserEvent>() }),
});
