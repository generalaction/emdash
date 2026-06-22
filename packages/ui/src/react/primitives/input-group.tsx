'use client';

import type { RecipeVariants } from '@vanilla-extract/recipes';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import * as styles from './input-group.css';

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(styles.inputGroup, className)}
      {...props}
    />
  );
}

type InputGroupAddonAlign = NonNullable<RecipeVariants<typeof styles.inputGroupAddon>>['align'];

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & { align?: InputGroupAddonAlign }) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(styles.inputGroupAddon({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...props}
    />
  );
}

function InputGroupButton({
  className,
  type = 'button',
  ...props
}: React.ComponentProps<typeof Button> & {
  type?: 'button' | 'submit' | 'reset';
}) {
  return (
    <Button
      type={type}
      size="sm"
      icon
      className={cn(styles.inputGroupButton, className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(styles.inputGroupText, className)} {...props} />;
}

function InputGroupInput({ className, size: _size, ...props }: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(styles.inputGroupControl, className)}
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(styles.inputGroupTextareaControl, className)}
      {...props}
    />
  );
}

export type { InputGroupAddonAlign };
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
