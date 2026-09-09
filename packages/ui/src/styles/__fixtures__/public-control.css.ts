import { control } from '../recipes/control';

export const publicControlClasses = [
  control(),
  control({ emphasis: 'minimal' }),
  control({ emphasis: 'medium', tone: 'warning' }),
  control({ emphasis: 'high', tone: 'destructive', size: 'lg', iconOnly: true }),
];
