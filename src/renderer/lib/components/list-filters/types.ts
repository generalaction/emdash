/** @description Represents a filter option with a generic string value and a display label. @template T - The type of the value, extending string. */
export type ListFilterOption<T extends string = string> = {
  value: T;
  label: string;
};
