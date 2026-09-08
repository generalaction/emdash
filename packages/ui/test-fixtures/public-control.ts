import {
  control,
  type ControlEmphasis,
  type ControlOptions,
  type ControlSize,
  type ControlTone,
} from '@emdash/ui/styles/recipes/control';

const emphasis: ControlEmphasis = 'high';
const size: ControlSize = 'sm';
const tone: ControlTone = 'destructive';
const options: ControlOptions = { emphasis, size, tone, iconOnly: true };

control();
control(options);

// @ts-expect-error Generic visual variants are not part of the public Recipe.
control({ variant: 'primary' });
// @ts-expect-error Internal class maps are not part of the public Recipe.
control({ classes: { root: 'override' } });
// @ts-expect-error Link presentation belongs to Button rather than shared sizing.
control({ size: 'link' });
