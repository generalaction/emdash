'use client';

import { cx } from '@styles/utilities/cx';
import { useRef } from 'react';
import * as ResizablePrimitive from 'react-resizable-panels';
import * as styles from './resizable.css';

export type ResizableGroupProps = ResizablePrimitive.GroupProps;
export type ResizablePanelProps = ResizablePrimitive.PanelProps;
export type ResizableHandleProps = ResizablePrimitive.SeparatorProps & {
  /**
   * `hairline` (default) renders an always-visible 1px line; `ghost` is
   * invisible until hovered, for layouts that draw their own divider.
   */
  variant?: 'hairline' | 'ghost';
};

/** Imperative handle for a Panel, obtained via `useResizablePanelRef`. */
export type ResizablePanelHandle = ResizablePrimitive.PanelImperativeHandle;

/**
 * Layout container for resizable panels. Renders panels side by side when
 * `orientation="horizontal"` (default) and stacked when `"vertical"`.
 */
function ResizableGroup(props: ResizableGroupProps) {
  return <ResizablePrimitive.Group data-slot="resizable-group" {...props} />;
}

function ResizablePanel(props: ResizablePanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * Drag handle between two panels.
 *
 * Restores keyboard focus to the previously-focused element after a pointer
 * drag: the separator receives focus on pointerdown, and without this it
 * would keep focus after the drag, silently stealing it from whatever the
 * user was working in (deliberate behavior carried over from the legacy app
 * kit). Capture-phase focus is used because react-resizable-panels overrides
 * a plain `onFocus` prop with its own internal handler.
 */
function ResizableHandle({
  className,
  variant = 'hairline',
  onFocusCapture,
  onPointerUp,
  onPointerCancel,
  ...props
}: ResizableHandleProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const restoreFocus = () => {
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  };

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cx(styles.handle({ variant }), className)}
      onFocusCapture={(e) => {
        // `document.activeElement` is already the separator by the time focus
        // fires; relatedTarget holds the element that was focused before it.
        if (e.relatedTarget instanceof HTMLElement) {
          previousFocusRef.current = e.relatedTarget;
        }
        onFocusCapture?.(e);
      }}
      onPointerUp={(e) => {
        restoreFocus();
        onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        restoreFocus();
        onPointerCancel?.(e);
      }}
      {...props}
    />
  );
}

export const Resizable = {
  Group: ResizableGroup,
  Panel: ResizablePanel,
  Handle: ResizableHandle,
};

// Panel-management hooks and persistence helper, exposed here so consumers
// depend on @emdash/ui rather than on react-resizable-panels directly.
export {
  useDefaultLayout as useResizableDefaultLayout,
  usePanelRef as useResizablePanelRef,
} from 'react-resizable-panels';
