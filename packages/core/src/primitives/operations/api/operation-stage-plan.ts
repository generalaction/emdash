import type { OperationStage } from './operation-state';

export type ExecutableOperationStage<TExecutor extends string = string> = OperationStage & {
  executor: TExecutor;
};

export type OperationStagePlanTemplate<TContext, TExecutor extends string = string> =
  | {
      kind: 'stage';
      stage: ExecutableOperationStage<TExecutor>;
    }
  | {
      kind: 'expansion';
      id: string;
      expand(context: TContext): readonly ExecutableOperationStage<TExecutor>[];
    };

export type OperationStagePlan<TContext, TExecutor extends string = string> = {
  templates: readonly OperationStagePlanTemplate<TContext, TExecutor>[];
};

export function defineOperationStagePlan<TContext, TExecutor extends string = string>(
  templates: readonly OperationStagePlanTemplate<TContext, TExecutor>[]
): OperationStagePlan<TContext, TExecutor> {
  return Object.freeze({ templates: Object.freeze([...templates]) });
}

export function expandOperationStagePlan<TContext, TExecutor extends string>(
  plan: OperationStagePlan<TContext, TExecutor>,
  context: TContext
): ExecutableOperationStage<TExecutor>[] {
  return plan.templates.flatMap((template) =>
    template.kind === 'stage' ? [template.stage] : template.expand(context)
  );
}
