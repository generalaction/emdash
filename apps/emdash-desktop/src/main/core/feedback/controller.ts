import { createRPCController } from '@shared/lib/ipc/rpc';
import { submitFeedback, type SubmitFeedbackInput } from './service';

export const feedbackController = createRPCController({
  submit: async (input: SubmitFeedbackInput) => {
    try {
      await submitFeedback(input);
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
