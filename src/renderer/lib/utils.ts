import { clsx, type ClassValue } from 'clsx';
import { DeepPartial } from 'src/main/settings';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function deepMerge<T>(base: T, update: DeepPartial<T>): T {
  const result = { ...(base as object) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object'
    ) {
      result[key] = deepMerge(result[key], value as DeepPartial<unknown>);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}
