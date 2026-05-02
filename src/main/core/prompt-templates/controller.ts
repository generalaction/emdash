import { createRPCController } from '@shared/ipc/rpc';
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  UpdatePromptTemplateInput,
} from '@shared/prompt-templates';
import { db } from '@main/db/client';
import { PromptTemplateService } from './service';

const promptTemplateService = new PromptTemplateService(db);

export const promptTemplatesController = createRPCController({
  list: (): Promise<PromptTemplate[]> => promptTemplateService.list(),

  getById: (id: string): Promise<PromptTemplate | null> => promptTemplateService.getById(id),

  create: (input: CreatePromptTemplateInput): Promise<PromptTemplate> =>
    promptTemplateService.create(input),

  update: (id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> =>
    promptTemplateService.update(id, input),

  delete: (id: string): Promise<void> => promptTemplateService.delete(id),

  reorder: (ids: string[]): Promise<void> => promptTemplateService.reorder(ids),
});
