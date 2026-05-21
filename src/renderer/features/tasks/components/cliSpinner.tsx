import { useSyncExternalStore } from 'react';

const FRAMES_1 = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAMES_2 = [
  '⠈',
  '⠉',
  '⠋',
  '⠓',
  '⠒',
  '⠐',
  '⠐',
  '⠒',
  '⠖',
  '⠦',
  '⠤',
  '⠠',
  '⠠',
  '⠤',
  '⠦',
  '⠖',
  '⠒',
  '⠐',
  '⠐',
  '⠒',
  '⠓',
  '⠋',
  '⠉',
  '⠈',
];

type SpinnerVariant = '1' | '2';

const FRAME_INTERVAL_MS = 80;

let intervalId: ReturnType<typeof setInterval> | null = null;
let tick = 0;

const listeners = new Set<() => void>();

const notifyListeners = () => {
  tick += 1;
  listeners.forEach((listener) => listener());
};

const stopSpinnerLoop = () => {
  if (intervalId === null) {
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
};

const startSpinnerLoop = () => {
  if (intervalId !== null) {
    return;
  }

  intervalId = setInterval(notifyListeners, FRAME_INTERVAL_MS);
};

const subscribeToSpinner = (listener: () => void) => {
  listeners.add(listener);
  startSpinnerLoop();

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      stopSpinnerLoop();
      tick = 0;
    }
  };
};

const getSpinnerSnapshot = () => tick;

export function CLISpinner({ variant = '1' }: { variant?: SpinnerVariant }) {
  const currentTick = useSyncExternalStore(
    subscribeToSpinner,
    getSpinnerSnapshot,
    getSpinnerSnapshot
  );
  const frames = variant === '1' ? FRAMES_1 : FRAMES_2;

  return <span className="text-foreground/60">{frames[currentTick % frames.length]}</span>;
}
