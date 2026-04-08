import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function CLISpinner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((index + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [index]);

  return <span className="text-foreground/60">{FRAMES[index]}</span>;
}
