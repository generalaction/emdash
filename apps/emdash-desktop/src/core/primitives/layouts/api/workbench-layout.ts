import { defineLayout, slot } from './define-layout';

export const WORKBENCH_BOTTOM_BAR_HEIGHT_PX = 40;

export const workbenchLayout = defineLayout({
  id: 'workbench',
  slots: {
    wrap: slot.wrapper(),
    titlebar: slot.optional(),
    main: slot.main(),
  },
});
