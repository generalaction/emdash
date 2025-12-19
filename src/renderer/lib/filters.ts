export interface FilterContext {
  phase: 'chunk' | 'final' | 'historical';
  taskId: string;
  conversationId?: string | null;
}

export type Filter = (input: string, ctx: FilterContext) => string;

export const noOp: Filter = (input) => input;

export const composeFilters = (filters: Filter[]): Filter => {
  if (filters.length === 0) {
    return noOp;
  }

  return (input, ctx) => filters.reduce((acc, filter) => filter(acc, ctx), input);
};

export const defaultPipeline = composeFilters([noOp]);
