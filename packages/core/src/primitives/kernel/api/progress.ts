export interface OperationProgress {
  operationId: string;
  stages: OperationStage[];
  updatedAt: number;
  done?: boolean;
}

export interface OperationStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  progress?: number;
  error?: { message: string };
  substages?: OperationStage[];
}

export interface ProgressSink {
  publish(progress: OperationProgress): void;
  end(operationId: string): void;
}
