import type { Unsubscribe } from '@emdash/shared';
import type { JsonValue, ViewRef } from '@core/primitives/views/api';

export interface HistoryEntry {
  readonly ref: ViewRef;
  readonly location?: JsonValue;
  readonly key: string;
}

export interface NavigationParticipant<TLocation extends JsonValue = JsonValue> {
  captureLocation(): TLocation | undefined;
  restoreLocation(location: TLocation): void;
}

export interface NavigationParticipantHost {
  attachParticipant<TLocation extends JsonValue>(
    ref: ViewRef,
    participant: NavigationParticipant<TLocation>
  ): Unsubscribe;
}

export type Resolution =
  | { readonly kind: 'ok' }
  | { readonly kind: 'redirect'; readonly ref: ViewRef };
