import { defineTypographyProfile } from '../core/compiler';

export const defaultTypography = defineTypographyProfile({
  id: 'default',
  label: 'Default',
  selector: '.typography-default',
  values: {
    'typography.family.sans': "'Inter Variable', sans-serif",
    'typography.family.mono':
      "'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Monaco, monospace",
    'typography.weight.normal': '400',
    'typography.weight.medium': '500',
    'typography.weight.semibold': '600',
    'typography.size.micro': '10px',
    'typography.size.tiny': '11px',
    'typography.size.xs': '12px',
    'typography.size.sm': '13px',
    'typography.size.base': '14px',
    'typography.size.lg': '17px',
    'typography.size.xl': '20px',
    'typography.size.twoXl': '24px',
    'typography.lineHeight.micro': '1.2',
    'typography.lineHeight.tiny': '1.3',
    'typography.lineHeight.xs': '1.5',
    'typography.lineHeight.sm': '1.5',
    'typography.lineHeight.base': '1.5',
    'typography.lineHeight.lg': '1.5',
    'typography.lineHeight.xl': '1.4',
    'typography.lineHeight.twoXl': '1.3',
  },
});

export const ALL_TYPOGRAPHIES = [defaultTypography] as const;
