import type { OperationStageDisplay } from '@primitives/operations/api';

export interface OperationProgress {
  operationId: string;
  stages: OperationStage[];
  updatedAt: number;
  done?: boolean;
}

export interface OperationStage extends OperationStageDisplay {
  substages?: OperationStage[];
}

export interface ProgressSink {
  publish(progress: OperationProgress): void;
  end(operationId: string): void;
}
