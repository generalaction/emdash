export type AuthoringStyleRule = {
  readonly '@layer'?: never;
  readonly [property: string]:
    | string
    | number
    | AuthoringStyleRule
    | readonly AuthoringStyleRule[]
    | undefined;
};

export type AuthoringStyleInput = AuthoringStyleRule | string | readonly AuthoringStyleInput[];
