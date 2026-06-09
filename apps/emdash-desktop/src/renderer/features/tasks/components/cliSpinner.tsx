import { useEffect, useState } from 'react';

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

export function CLISpinner({ variant = '1' }: { variant?: '1' | '2' }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((index + 1) % (variant === '1' ? FRAMES_1.length : FRAMES_2.length));
    }, 80);
    return () => clearInterval(interval);
  }, [index, variant]);

  return (
    <span className="text-foreground/60">
      {variant === '1' ? FRAMES_1[index] : FRAMES_2[index]}
    </span>
  );
}
