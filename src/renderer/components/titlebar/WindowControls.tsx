import React, { useCallback, useEffect, useState } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';

const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.windowIsMaximized().then(setIsMaximized);
    const unsub = window.electronAPI.onWindowMaximizeChange(setIsMaximized);
    return unsub;
  }, []);

  const handleMinimize = useCallback(() => {
    window.electronAPI.windowMinimize();
  }, []);

  const handleMaximize = useCallback(() => {
    window.electronAPI.windowMaximize();
  }, []);

  const handleClose = useCallback(() => {
    window.electronAPI.windowClose();
  }, []);

  return (
    <div className="flex items-center [-webkit-app-region:no-drag]">
      <button
        type="button"
        onClick={handleMinimize}
        className="flex h-[var(--tb,36px)] w-[46px] items-center justify-center text-foreground/70 transition-colors hover:bg-foreground/10"
        aria-label="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleMaximize}
        className="flex h-[var(--tb,36px)] w-[46px] items-center justify-center text-foreground/70 transition-colors hover:bg-foreground/10"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <Copy className="h-3.5 w-3.5 rotate-180" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={handleClose}
        className="flex h-[var(--tb,36px)] w-[46px] items-center justify-center text-foreground/70 transition-colors hover:bg-red-600 hover:text-white"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default WindowControls;
