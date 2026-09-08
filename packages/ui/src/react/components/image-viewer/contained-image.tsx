import { cx } from '@styles/index';
import * as React from 'react';
import * as styles from './image-viewer.css';

export type ContainedImageProps = React.ComponentPropsWithoutRef<'img'>;

/**
 * Dedicated image asset adapter that letterboxes into its box.
 *
 * Image bytes and intrinsic metadata stay on the native `<img>` ownership
 * boundary rather than flowing through Icon or an SVG descendant rule.
 */
export function ContainedImage({ className, alt, ...props }: ContainedImageProps) {
  return (
    <img
      alt={alt ?? ''}
      className={cx(styles.containedImage, className)}
      data-foreign-adapter="image"
      {...props}
    />
  );
}
