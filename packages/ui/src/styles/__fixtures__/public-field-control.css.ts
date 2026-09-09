import { fieldControl } from '../recipes/field-control';

export const publicFieldControlClasses = [
  fieldControl(),
  fieldControl({ size: 'sm' }),
  fieldControl({ tone: 'warning' }),
  fieldControl({ size: 'base', tone: 'destructive' }),
];
