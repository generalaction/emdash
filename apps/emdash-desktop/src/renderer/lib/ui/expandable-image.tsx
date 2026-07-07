import { Expand } from 'lucide-react';
import type React from 'react';
import { useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { ContainedImage } from './contained-image';
import { ZoomableContentDialog } from './zoomable-content-dialog';

type ExpandableImageProps = React.ComponentPropsWithoutRef<'img'> & {
  containerClassName?: string;
};

export function ExpandableImage({
  className,
  containerClassName,
  src,
  alt,
  ...props
}: ExpandableImageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasBeenOpenedRef = useRef(false);
  const imageAlt = alt ?? '';

  if (!src) {
    return <ContainedImage src={src} alt={imageAlt} className={className} {...props} />;
  }

  const openImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    hasBeenOpenedRef.current = true;
    setIsExpanded(true);
  };

  const shouldRenderDialog = isExpanded || hasBeenOpenedRef.current;

  return (
    <span
      className={cn('group/image relative inline-block max-w-full align-top', containerClassName)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              aria-label="Expand image"
              className="absolute top-1 right-1 z-10 opacity-0 shadow-sm ring-1 ring-border/80 transition-opacity group-hover/image:opacity-100 focus-visible:opacity-100"
              onClick={openImage}
            >
              <Expand className="size-3" />
            </Button>
          }
        />
        <TooltipContent side="left" align="end">
          Expand image
        </TooltipContent>
      </Tooltip>
      <ContainedImage src={src} alt={imageAlt} className={className} {...props} />
      {shouldRenderDialog && (
        <ZoomableContentDialog
          open={isExpanded}
          ariaLabel={imageAlt ? `Image: ${imageAlt}` : 'Image'}
          contentKey={`${src}:${imageAlt}`}
          onOpenChange={setIsExpanded}
          wrapperClassName="rounded-md bg-muted/20"
        >
          {({ fitToView }) => (
            <ContainedImage
              src={src}
              alt={imageAlt}
              className={cn(className, 'block h-auto max-h-none max-w-none rounded-none')}
              {...props}
              onLoad={(event) => {
                props.onLoad?.(event);
                fitToView();
              }}
            />
          )}
        </ZoomableContentDialog>
      )}
    </span>
  );
}
