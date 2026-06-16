import * as React from 'react';
import { cn, textVariants, type TextVariantProps } from './typography.variants';

type AsProp<C extends React.ElementType> = { as?: C };

type PropsWithAs<C extends React.ElementType, P = object> = AsProp<C> &
  Omit<React.ComponentPropsWithRef<C>, keyof AsProp<C> | keyof P> &
  P;

export type TextProps<C extends React.ElementType = 'span'> = PropsWithAs<
  C,
  TextVariantProps & { className?: string }
>;

/**
 * Text — polymorphic prose component applying a typography role.
 *
 * Defaults to <span>. Override the element with `as`:
 *   <Text as="p" variant="body">…</Text>
 *   <Text as="label" variant="bodyBold" tone="muted">…</Text>
 *   <Text as="code" variant="inlineCode">…</Text>
 */
export function Text<C extends React.ElementType = 'span'>({
  as,
  variant,
  tone,
  className,
  ...props
}: TextProps<C>) {
  const Component = as ?? 'span';
  return <Component className={cn(textVariants({ variant, tone }), className)} {...props} />;
}
