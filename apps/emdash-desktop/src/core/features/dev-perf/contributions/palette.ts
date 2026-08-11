import { definePaletteItem } from '@core/primitives/palette/api';
import { devPerfCaptureTraceCommand, devProcessPanelCommand } from './commands';

export const DEV_PERF_PALETTE_ITEMS = [
  definePaletteItem({ command: devProcessPanelCommand, rank: 900 }),
  definePaletteItem({ command: devPerfCaptureTraceCommand, rank: 910 }),
] as const;
