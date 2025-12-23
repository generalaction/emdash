export type AcpConfigOption = {
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  type?: string;
  value?: unknown;
  currentValue?: unknown;
  current_value?: unknown;
  selectedValue?: unknown;
  options?: unknown[];
  possibleValues?: unknown[];
  values?: unknown[];
  allowedValues?: unknown[];
};

export type AcpModel = {
  id?: string;
  name?: string;
  label?: string;
  displayName?: string;
  title?: string;
  description?: string;
  model?: string;
};
