import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent } from '@renderer/lib/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

interface ZoomableContentDialogProps {
  open: boolean;
  ariaLabel: string;
  contentKey: string;
  onOpenChange: (open: boolean) => void;
  contentClassName?: string;
  overlayClassName?: string;
  wrapperClassName?: string;
  children: (api: { fitToView: (animationTime?: number) => void }) => React.ReactNode;
}

interface ZoomToolbarProps {
  controls: ReactZoomPanPinchContentRef;
  onFit: () => void;
  onClose: () => void;
}

interface ZoomBounds {
  minScale: number;
  maxScale: number;
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 64;
const MAX_INITIAL_ZOOM = 12;
const MIN_ZOOM_OUT_FACTOR = 0.5;
const MAX_ZOOM_IN_FACTOR = 10;
const DEFAULT_ZOOM_BOUNDS: ZoomBounds = {
  minScale: MIN_ZOOM,
  maxScale: MAX_ZOOM,
};

const toolbarButtonClassName =
  'size-7 rounded-none border-0 bg-transparent text-foreground-muted hover:bg-background-1 hover:text-foreground first:rounded-l-md last:rounded-r-md';

function ToolbarButton({ label, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={toolbarButtonClassName}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function fitContentToView(controls: ReactZoomPanPinchContentRef, animationTime = 0): number | null {
  const { wrapperComponent, contentComponent } = controls.instance;
  if (!wrapperComponent || !contentComponent) return null;

  const contentWidth = contentComponent.offsetWidth;
  const contentHeight = contentComponent.offsetHeight;
  if (contentWidth <= 0 || contentHeight <= 0) return null;

  const scale = Math.min(
    MAX_INITIAL_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        wrapperComponent.offsetWidth / contentWidth,
        wrapperComponent.offsetHeight / contentHeight
      )
    )
  );

  controls.centerView(scale, animationTime);
  return scale;
}

function zoomBoundsForFitScale(fitScale: number): ZoomBounds {
  return {
    minScale: Math.max(MIN_ZOOM, fitScale * MIN_ZOOM_OUT_FACTOR),
    maxScale: Math.min(MAX_ZOOM, Math.max(fitScale * MAX_ZOOM_IN_FACTOR, fitScale + 4)),
  };
}

function scheduleFitContentToView(
  controls: ReactZoomPanPinchContentRef,
  setZoomBounds: React.Dispatch<React.SetStateAction<ZoomBounds>>,
  animationTime = 0
) {
  window.requestAnimationFrame(() => {
    const fitScale = fitContentToView(controls, animationTime);
    if (fitScale !== null) setZoomBounds(zoomBoundsForFitScale(fitScale));
  });
}

function ZoomToolbar({ controls, onFit, onClose }: ZoomToolbarProps) {
  return (
    <div className="flex justify-end p-3 pb-2">
      <div className="flex items-center overflow-hidden rounded-md border border-border bg-background/95 shadow-sm">
        <ToolbarButton label="Zoom in" onClick={() => controls.zoomIn(ZOOM_STEP)}>
          <Plus className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Zoom out" onClick={() => controls.zoomOut(ZOOM_STEP)}>
          <Minus className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Fit to view" onClick={onFit}>
          <RotateCcw className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}

export function ZoomableContentDialog({
  open,
  ariaLabel,
  contentKey,
  onOpenChange,
  contentClassName,
  overlayClassName,
  wrapperClassName,
  children,
}: ZoomableContentDialogProps) {
  const [zoomBounds, setZoomBounds] = useState<ZoomBounds>(DEFAULT_ZOOM_BOUNDS);
  const [openSession, setOpenSession] = useState(0);

  useEffect(() => {
    if (!open) return;

    setZoomBounds(DEFAULT_ZOOM_BOUNDS);
    setOpenSession((session) => session + 1);
  }, [open, contentKey]);

  const fitToView = (controls: ReactZoomPanPinchContentRef, animationTime = 0) => {
    const fitScale = fitContentToView(controls, animationTime);
    if (fitScale !== null) setZoomBounds(zoomBoundsForFitScale(fitScale));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={ariaLabel}
        overlayClassName={overlayClassName}
        className={cn(
          'top-[calc(50%+1rem)] h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)]',
          contentClassName
        )}
      >
        <TransformWrapper
          key={`${contentKey}:${openSession}`}
          limitToBounds={false}
          minScale={zoomBounds.minScale}
          maxScale={zoomBounds.maxScale}
          wheel={{ step: 0.12 }}
          doubleClick={{ mode: 'toggle' }}
          onInit={(controls) => scheduleFitContentToView(controls, setZoomBounds)}
        >
          {(controls) => (
            <>
              <ZoomToolbar
                controls={controls}
                onFit={() => fitToView(controls, 200)}
                onClose={() => onOpenChange(false)}
              />
              <div className="min-h-0 flex-1 px-2 pb-2">
                <TransformComponent
                  wrapperClass={wrapperClassName}
                  wrapperStyle={{ height: '100%', width: '100%' }}
                  contentStyle={{ height: 'fit-content', width: 'fit-content' }}
                >
                  {children({
                    fitToView: (animationTime = 0) => fitToView(controls, animationTime),
                  })}
                </TransformComponent>
              </div>
            </>
          )}
        </TransformWrapper>
      </DialogContent>
    </Dialog>
  );
}
