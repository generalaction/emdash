import { log } from '@renderer/lib/logger';

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));

export const loadPanelSizes = (storageKey: string, fallbackSizes: number[]): number[] => {
  if (typeof window === 'undefined') {
    return fallbackSizes;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) {
      return fallbackSizes;
    }

    const parsed = JSON.parse(storedValue);
    return isNumberArray(parsed) ? parsed : fallbackSizes;
  } catch (error) {
    log.warn('Failed to load panel sizes from localStorage', error);
    return fallbackSizes;
  }
};

export const savePanelSizes = (storageKey: string, sizes: number[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(sizes));
  } catch (error) {
    log.warn('Failed to save panel sizes to localStorage', error);
  }
};
