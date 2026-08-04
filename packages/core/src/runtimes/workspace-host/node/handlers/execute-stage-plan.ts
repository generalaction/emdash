import type { HandlerContext } from '@primitives/kernel/api';
import type { ExecutableOperationStage, OperationStagePlan } from '@primitives/operations/api';

type StageExecutor = (stage: ExecutableOperationStage) => Promise<void>;

export async function executeStagePlan<TContext>(
  ctx: Pick<HandlerContext<unknown, unknown>, 'stage'>,
  plan: OperationStagePlan<TContext>,
  context: TContext,
  executors: Readonly<Record<string, StageExecutor>>
): Promise<void> {
  for (const template of plan.templates) {
    const stages = template.kind === 'stage' ? [template.stage] : template.expand(context);
    for (const stage of stages) {
      const execute = executors[stage.executor];
      if (!execute) throw new Error(`No executor for operation stage '${stage.executor}'`);
      await ctx.stage(stage.id, stage.label, () => execute(stage));
    }
  }
}

export function stageTarget(stage: ExecutableOperationStage): string {
  if (!stage.targetPath) throw new Error(`Operation stage '${stage.id}' has no target path`);
  return stage.targetPath;
}
