import {
  fieldControl,
  type FieldControlOptions,
  type FieldControlSize,
  type FieldControlTone,
} from '@emdash/ui/styles/recipes/field-control';

const size: FieldControlSize = 'sm';
const tone: FieldControlTone = 'warning';
const options: FieldControlOptions = { size, tone };

fieldControl();
fieldControl(options);

// @ts-expect-error Internal field-shell interaction modes are private.
fieldControl({ interaction: 'within' });
// @ts-expect-error Field-control has no generic variant map.
fieldControl({ variant: 'outline' });

void [size, tone, options];
