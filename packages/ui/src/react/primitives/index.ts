// ── Single-component primitives (named exports) ───────────────────────────────
export { Box } from './box';
export { Breadcrumbs, type BreadcrumbItem, type BreadcrumbsProps } from './breadcrumbs';
export { Button, type ButtonProps } from './button';
export { Icon, type IconName, type IconProps, type IconSize } from './icon';
export { Input, type InputProps } from './input';
export { Textarea, type TextareaProps } from './textarea';
export { Switch, type SwitchProps } from './switch';
export { SearchInput, type SearchInputProps } from './search-input';
export { ScrollContainer, type ScrollContainerProps } from './scroll-container';
export { SeparatedList, type SeparatedListProps } from './separated-list';
export { Surface, useSurfaceLevel, type SurfaceProps } from './surface/surface';
export { TriggerButton, type TriggerButtonProps } from './trigger-button';
export { Text, type TextProps } from './typography/Text';
export { Heading, type HeadingProps } from './typography/Heading';
export { textVariants, type TextVariantProps } from './typography/typography.variants';

// ── Toggle (standalone) + ToggleGroup namespace ───────────────────────────────
export { Toggle, ToggleGroup, type ToggleProps, type ToggleGroupProps } from './toggle';

// ── Multi-part namespace consts ───────────────────────────────────────────────
export { Select } from './select';
export { RadioGroup } from './radio-group';
export { Dialog, type DialogSize } from './dialog';
export { Sheet, type SheetSide } from './sheet';
export { Popover } from './popover';
export { DropdownMenu } from './dropdown-menu';
export { Combobox, useComboboxAnchor } from './combobox/combobox';
export { Tabs, type TabsTabProps } from './tabs/tabs';
export { Collapsible, type CollapsibleTriggerProps } from './collapsible';
export { InputGroup, type InputGroupAddonAlign } from './input-group';
export { Alert, type AlertProps } from './alert';

// ── Non-namespaced compound helpers (remain as named exports) ─────────────────
export {
  ComboboxPopup,
  ComboboxPopupDismiss,
  type ComboboxPopupItem,
  type ComboboxPopupHandle,
} from './combobox/combobox-popup';
export {
  useHoverCard,
  HoverCard,
  isEventInsideInteractiveLayer,
  type HoverCardController,
  type HoverCardRowProps,
  type HoverCardProps,
} from './hover-card';
export {
  SplitButton,
  type SplitButtonProps,
  type SplitButtonOption,
  type SplitButtonOptionTone,
} from './split-button';

export { SegmentedSpinnerIcon, type SegmentedSpinnerIconProps } from './segmented-spinner';

// ── Theme / provider ──────────────────────────────────────────────────────────
export {
  ThemeProvider,
  useTheme,
  usePortalThemeClass,
  THEME_MANIFEST,
  type ThemeId,
  type ThemeProviderProps,
} from './theme-provider';

// ── Utility / recipe re-exports ───────────────────────────────────────────────
export { resolveFileIconClass } from '../lib/file-icons';
export { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
export { inputVariants, type InputVariantProps } from '@styles/recipes/input';
