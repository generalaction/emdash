import type { AcpModel } from './types/acp';

export const extractModelsFromPayload = (payload: any): AcpModel[] => {
  if (!payload) return [];
  const direct =
    payload.models ??
    payload.availableModels ??
    payload.available_models ??
    payload.modelList ??
    payload.model_list ??
    payload.modelOptions ??
    payload.model_options;
  if (Array.isArray(direct)) return direct as AcpModel[];
  const nested =
    payload.models?.available ??
    payload.models?.availableModels ??
    payload.models?.models ??
    payload.modelOptions?.options ??
    payload.model_options?.options;
  if (Array.isArray(nested)) return nested as AcpModel[];
  return [];
};

export const extractCurrentModelId = (payload: any): string | null => {
  if (!payload) return null;
  const nestedModels = payload.models ?? payload.modelOptions ?? payload.model_options;
  const nestedCurrent =
    nestedModels?.currentModelId ??
    nestedModels?.current_model_id ??
    nestedModels?.modelId ??
    nestedModels?.model_id ??
    nestedModels?.currentModel ??
    nestedModels?.current_model;
  if (nestedCurrent) return String(nestedCurrent);
  const direct =
    payload.currentModelId ??
    payload.modelId ??
    payload.model ??
    payload.current_model_id ??
    payload.current_model ??
    payload.activeModelId ??
    payload.active_model_id;
  if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  if (direct && typeof direct === 'object') {
    const nested = direct.id ?? direct.modelId ?? direct.model_id ?? direct.name;
    if (nested) return String(nested);
  }
  return null;
};
