import type React from 'react';
import { cn } from '@renderer/utils/utils';

type ContainedImageProps = React.ComponentPropsWithoutRef<'img'>;

export function ContainedImage({ className, alt, ...props }: ContainedImageProps) {
  return <img alt={alt ?? ''} className={cn('object-contain', className)} {...props} />;
}
