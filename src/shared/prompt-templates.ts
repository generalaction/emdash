export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptTemplateInput {
  name: string;
  text: string;
}

export interface UpdatePromptTemplateInput {
  name?: string;
  text?: string;
  sortOrder?: number;
}
