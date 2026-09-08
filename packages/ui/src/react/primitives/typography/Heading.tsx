import { cx } from '@styles/index';
import * as React from 'react';
import type { TextTone, TextVariant } from './Text';
import { textVariants } from './typography.variants.css';

type HeadingLevel = 1 | 2 | 3 | 4;

export type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & {
  level: HeadingLevel;
  tone?: TextTone;
  className?: string;
};

const levelToVariant: Record<HeadingLevel, TextVariant> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'section',
};

const levelToTag: Record<HeadingLevel, 'h1' | 'h2' | 'h3' | 'h4'> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
};

/**
 * Heading — renders an h1/h2/h3/h4 element with the matching typography role.
 *
 *   <Heading level={1}>Title</Heading>
 *   <Heading level={2} tone="muted">Subtitle</Heading>
 *
 * `className` is applied to the rendered heading root.
 */
export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level, tone, className, ...props },
  ref
) {
  const Tag = levelToTag[level];
  const variant = levelToVariant[level];
  return <Tag ref={ref} className={cx(textVariants({ variant, tone }), className)} {...props} />;
});
