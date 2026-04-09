import type {
  FocusContext,
  FocusedRegion,
  FocusMainPanel,
  FocusRightPanel,
  FocusTrigger,
  FocusView,
  TelemetryEventProperties,
} from '@shared/telemetry';

interface FocusState {
  view: FocusView | null;
  mainPanel: FocusMainPanel | null;
  rightPanel: FocusRightPanel | null;
  focusedRegion: FocusedRegion | null;
  conversationIndex: number | null;
}

export interface FocusTransitionResult {
  previous: FocusState;
  durationMs: number;
  changed: boolean;
}

type FocusChangedPayload = TelemetryEventProperties['focus_changed'];

type TransitionEmitter = (payload: FocusChangedPayload) => void;

const FORCE_TRANSITION_TRIGGERS = new Set<FocusTrigger>([
  'window_blur',
  'window_focus',
  'modal_open',
  'modal_close',
  'app_quit',
]);

export class FocusTracker {
  private state: FocusState = {
    view: null,
    mainPanel: null,
    rightPanel: null,
    focusedRegion: null,
    conversationIndex: null,
  };

  private enteredAt = Date.now();
  private sessionStart = Date.now();
  private initialized = false;
  private transitionEmitter?: TransitionEmitter;

  initialize(initial: Partial<FocusState>): void {
    if (this.initialized) return;
    this.state = {
      ...this.state,
      ...initial,
    };
    this.enteredAt = Date.now();
    this.sessionStart = Date.now();
    this.initialized = true;
  }

  setTransitionEmitter(emitter: TransitionEmitter): void {
    this.transitionEmitter = emitter;
  }

  transition(partial: Partial<FocusState>, trigger: FocusTrigger): FocusTransitionResult | null {
    if (!this.initialized) {
      this.initialize(partial);
      return null;
    }

    const previous = { ...this.state };
    const changed = (Object.keys(partial) as Array<keyof FocusState>).some((key) => {
      const value = partial[key];
      if (value === undefined) return false;
      return this.state[key] !== value;
    });
    if (!changed && !FORCE_TRANSITION_TRIGGERS.has(trigger)) {
      return null;
    }

    const now = Date.now();
    const durationMs = Math.max(0, now - this.enteredAt);

    this.transitionEmitter?.({
      view: previous.view,
      main_panel: previous.mainPanel,
      right_panel: previous.rightPanel,
      focused_region: previous.focusedRegion,
      conversation_index: previous.conversationIndex,
      duration_ms: durationMs,
      trigger,
    });

    this.state = {
      ...this.state,
      ...partial,
    };
    this.enteredAt = now;

    return {
      previous,
      durationMs,
      changed,
    };
  }

  getContext(): FocusContext {
    return {
      active_view: this.state.view,
      active_main_panel: this.state.mainPanel,
      active_right_panel: this.state.rightPanel,
      focused_region: this.state.focusedRegion,
      conversation_index: this.state.conversationIndex,
      time_in_view_ms: Math.max(0, Date.now() - this.enteredAt),
      session_duration_ms: Math.max(0, Date.now() - this.sessionStart),
    };
  }
}

export const focusTracker = new FocusTracker();
