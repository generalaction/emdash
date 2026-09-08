// ── Single-component primitives (named exports) ───────────────────────────────
export { AnimatedHeight, type AnimatedHeightProps } from './animated-height';
export { Badge, type BadgeProps, type BadgeTone, type BadgeVariant } from './badge';
export { Breadcrumbs, type BreadcrumbItem, type BreadcrumbsProps } from './breadcrumbs';
export { Button, type ButtonProps, type ButtonVariant } from './button';
export { Checkbox, type CheckboxProps } from './checkbox';
export {
  DirectoryField,
  type DirectoryFieldProps,
  type DirectoryFieldSize,
} from './directory-field';
export {
  Icon,
  IconSlot,
  type IconProps,
  type IconSize,
  type IconSlotProps,
  type StaticSvgComponent,
} from './icon';
export { Input, type InputProps } from './input';
export { Kbd, KbdGroup, type KbdGroupProps, type KbdProps } from './kbd';
export { Label, MicroLabel, type LabelProps } from './label';
export { Separator, type SeparatorProps } from './separator';
export { Spinner, type SpinnerProps, type SpinnerSize } from './spinner';
export { ModalLayout, type ModalLayoutProps } from './modal-layout';
export { ShowHide, type ShowHideProps } from './show-hide';
export { Textarea, type TextareaProps } from './textarea';
export { Switch, type SwitchProps } from './switch';
export { SearchInput, type SearchInputProps } from './search-input';
export { ScrollContainer, type ScrollContainerProps } from './scroll-container';
export { SeparatedList, type SeparatedListProps } from './separated-list';
export { SelectableCard, type SelectableCardProps } from './selectable-card';
export { Surface, type SurfaceProps } from './surface/surface';
export { TriggerButton, type TriggerButtonProps } from './trigger-button';
export { Text, type TextProps, type TextTone, type TextVariant } from './typography/Text';
export { AbsoluteTime, type AbsoluteTimeProps } from './time/absolute-time';
export { RelativeTime, type RelativeTimeProps } from './time/relative-time';
export { Heading, type HeadingProps } from './typography/Heading';

// ── Toggle (standalone) + ToggleGroup namespace ───────────────────────────────
export {
  Toggle,
  ToggleGroup,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
  type ToggleProps,
} from './toggle';

// ── Multi-part namespace consts ───────────────────────────────────────────────
export { Select } from './select';
export { RadioGroup } from './radio-group';
export { Dialog, type DialogSize } from './dialog';
export { Sheet, type SheetSide } from './sheet';
export { Popover } from './popover';
export { Tooltip } from './tooltip';
export { DropdownMenu } from './dropdown-menu';
export { ContextMenu } from './context-menu';
export { Combobox, useComboboxAnchor } from './combobox/combobox';
export { Tabs, type TabsTabProps } from './tabs/tabs';
export { Collapsible, type CollapsibleTriggerProps } from './collapsible';
export {
  InputGroup,
  type InputGroupAddonAlign,
  type InputGroupAddonProps,
  type InputGroupAppearance,
  type InputGroupButtonProps,
  type InputGroupInputProps,
  type InputGroupRootProps,
  type InputGroupTextProps,
  type InputGroupTextareaProps,
} from './input-group';
export { Alert, type AlertProps } from './alert';
export {
  Field,
  type FieldLegendProps,
  type FieldLegendVariant,
  type FieldOrientation,
  type FieldRootProps,
} from './field';
export {
  Resizable,
  useCollapsiblePanelBinding,
  useResizableDefaultLayout,
  type CollapsiblePanelBinding,
  type CollapsiblePanelBindingOptions,
  type LayoutStorage,
  type ResizableGroupProps,
  type ResizableHandleProps,
  type ResizablePanelProps,
} from './resizable';

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
export {
  useAsyncAction,
  type AsyncActionTrigger,
  type UseAsyncActionOptions,
} from './hooks/use-async-action';

// ── Toast (imperative namespace + hook + app-mounted Toaster) ────────────────
export {
  Toaster,
  toast,
  useToast,
  type ToastAction,
  type ToastId,
  type ToastOptions,
  type ToastPromiseMessages,
  type ToastTone,
  type ToasterProps,
} from './toast';

export { resolveFileIconClass } from '../lib/file-icons';
