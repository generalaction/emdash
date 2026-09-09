import { menuItem } from '../recipes/menu-item';

export const defaultItem = menuItem();
export const destructiveItem = menuItem({ tone: 'destructive' });
export const selectedRow = menuItem({
  fullWidth: true,
  muted: true,
  trailingIndicator: true,
});
