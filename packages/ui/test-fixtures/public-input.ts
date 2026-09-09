import type { InputProps } from '@emdash/ui/react/primitives';

const base: InputProps = {
  size: 'base',
  tone: 'neutral',
};
const small: InputProps = {
  size: 'sm',
  tone: 'warning',
};

// @ts-expect-error Input size remains the finite public semantic size.
const invalidSize: InputProps = { size: 'large' };
// @ts-expect-error Internal field-shell modes are not public Input props.
const invalidBare: InputProps = { bare: true };
// @ts-expect-error Tone is a finite semantic status.
const invalidTone: InputProps = { tone: 'brand' };

void [base, small, invalidSize, invalidBare, invalidTone];
