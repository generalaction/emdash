'use client';

import * as React from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type PanelGroupProps,
  type PanelProps,
  type PanelResizeHandleProps,
} from 'react-resizable-panels';
import { cn } from '@renderer/lib/utils';

const ResizablePanelGroup = React.forwardRef<React.ElementRef<typeof PanelGroup>, PanelGroupProps>(
  ({ className, ...props }, ref) => (
    <PanelGroup
      ref={ref}
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)}
      {...props}
    />
  )
);
ResizablePanelGroup.displayName = 'ResizablePanelGroup';

const ResizablePanel = React.forwardRef<React.ElementRef<typeof Panel>, PanelProps>(
  (props, ref) => <Panel ref={ref} data-slot="resizable-panel" {...props} />
);
ResizablePanel.displayName = 'ResizablePanel';

function ResizableHandle({
  className,
  ...props
}: PanelResizeHandleProps & {
  withHandle?: boolean;
}) {
  return (
    <PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px items-center hover:cursor-col-resize justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90',
        className
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
