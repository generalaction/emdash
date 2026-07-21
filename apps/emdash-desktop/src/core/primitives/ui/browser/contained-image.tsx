import type React from 'react';
import { cn } from '@core/primitives/ui/browser/cn';

type ContainedImageProps = React.ComponentPropsWithoutRef<'img'>;

export function ContainedImage({ className, alt, ...props }: ContainedImageProps) {
  return <img alt={alt ?? ''} className={cn('object-contain', className)} {...props} />;
}
