import * as React from 'react';
import { Input } from './input';
import { useToast } from '../../hooks/use-toast';
import { cn } from '@/lib/utils';

export interface SlugInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /**
   * Called when the normalized value changes.
   * The value will already be normalized (lowercase, spaces→hyphens, invalid chars removed).
   */
  onChange?: (value: string) => void;
  /**
   * Maximum length for the slug (default: 64)
   */
  maxLength?: number;
  /**
   * Show a toast when user tries to input invalid characters (default: true)
   */
  showInvalidCharToast?: boolean;
  /**
   * Custom message for invalid character toast
   */
  invalidCharMessage?: string;
}

/**
 * Normalizes input to a valid slug:
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes invalid characters (only a-z, 0-9, - allowed)
 * - Collapses consecutive hyphens
 * - Removes leading/trailing hyphens
 */
const normalizeToSlug = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Checks if a character is valid for a slug
 */
const isValidSlugChar = (char: string): boolean => /^[a-zA-Z0-9\s-]$/.test(char);

/**
 * An input that automatically normalizes values to valid slugs.
 * - Spaces are converted to hyphens as you type
 * - Invalid characters are blocked with an optional toast notification
 * - Output is always lowercase with only a-z, 0-9, and hyphens
 */
const SlugInput = React.forwardRef<HTMLInputElement, SlugInputProps>(
  (
    {
      className,
      onChange,
      maxLength = 64,
      showInvalidCharToast = true,
      invalidCharMessage = 'Only letters, numbers, and hyphens are allowed',
      value,
      ...props
    },
    ref
  ) => {
    const { toast } = useToast();
    const lastToastTimeRef = React.useRef<number>(0);
    const toastCooldownMs = 2000; // Don't spam toasts

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const cursorPosition = e.target.selectionStart || 0;

        // Check if any invalid characters were typed
        const hasInvalidChars = rawValue.split('').some((char) => !isValidSlugChar(char));

        if (hasInvalidChars && showInvalidCharToast) {
          const now = Date.now();
          if (now - lastToastTimeRef.current > toastCooldownMs) {
            lastToastTimeRef.current = now;
            toast({
              description: invalidCharMessage,
            });
          }
        }

        // Normalize the value
        const normalized = normalizeToSlug(rawValue).slice(0, maxLength);
        onChange?.(normalized);

        // Try to preserve cursor position after normalization
        // This is a best-effort - complex edits may jump the cursor
        requestAnimationFrame(() => {
          const input = e.target;
          if (input && document.activeElement === input) {
            // Adjust cursor for removed characters before cursor position
            const charsBeforeCursor = rawValue.slice(0, cursorPosition);
            const normalizedBeforeCursor = normalizeToSlug(charsBeforeCursor);
            const newPosition = Math.min(normalizedBeforeCursor.length, normalized.length);
            input.setSelectionRange(newPosition, newPosition);
          }
        });
      },
      [onChange, maxLength, showInvalidCharToast, invalidCharMessage, toast]
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Allow control keys
        if (
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)
        ) {
          return;
        }

        // Block invalid characters at keydown level for immediate feedback
        if (e.key.length === 1 && !isValidSlugChar(e.key)) {
          e.preventDefault();
          if (showInvalidCharToast) {
            const now = Date.now();
            if (now - lastToastTimeRef.current > toastCooldownMs) {
              lastToastTimeRef.current = now;
              toast({
                description: invalidCharMessage,
              });
            }
          }
        }
      },
      [showInvalidCharToast, invalidCharMessage, toast]
    );

    // Handle paste - normalize pasted content
    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        const currentValue = (value as string) || '';
        const input = e.currentTarget;
        const selectionStart = input.selectionStart || 0;
        const selectionEnd = input.selectionEnd || 0;

        // Insert pasted text at cursor position
        const newValue =
          currentValue.slice(0, selectionStart) + pastedText + currentValue.slice(selectionEnd);

        const normalized = normalizeToSlug(newValue).slice(0, maxLength);
        onChange?.(normalized);

        // Check if pasted content had invalid chars
        const hasInvalidChars = pastedText.split('').some((char) => !isValidSlugChar(char));
        if (hasInvalidChars && showInvalidCharToast) {
          const now = Date.now();
          if (now - lastToastTimeRef.current > toastCooldownMs) {
            lastToastTimeRef.current = now;
            toast({
              description: invalidCharMessage,
            });
          }
        }
      },
      [value, onChange, maxLength, showInvalidCharToast, invalidCharMessage, toast]
    );

    return (
      <Input
        ref={ref}
        className={cn(className)}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        {...props}
      />
    );
  }
);

SlugInput.displayName = 'SlugInput';

export { SlugInput };
