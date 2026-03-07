export type Ok<T> = { readonly success: true; readonly data: T };
export type Err<E> = { readonly success: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export const ok = <T>(data: T = undefined as T): Ok<T> => ({ success: true, data });
export const err = <E>(error: E): Err<E> => ({ success: false, error });
