import { style } from '@vanilla-extract/css';
import { sx } from '../../styles/sprinkles.css';
import { textShimmer } from '../../styles/effects.css';

export const toolRow = sx({ display: 'flex', alignItems: 'center', gap: '1.5', color: 'fgPassive', userSelect: 'none' });
// fontSize 'sm' from sprinkles = 0.875rem
export const toolName = style({ fontSize: '0.875rem' });
export const toolSummary = style([
  {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.75,
  },
  toolName,
]);

export { textShimmer };
