import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { devPerfCaptureTraceCommand, devProcessPanelCommand } from './commands';

export const DEV_PERF_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({ command: devProcessPanelCommand }),
  defineCommandPaletteItem({ command: devPerfCaptureTraceCommand }),
] as const;
