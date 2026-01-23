import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CornerDownLeft, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Input } from './ui/input';

type TerminalSettings = {
  fontFamily: string;
};

const DEFAULTS: TerminalSettings = {
  fontFamily: '',
};

const TerminalSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [showSaved, setShowSaved] = useState<boolean>(false);
  const savedValueRef = useRef<string>('');

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.terminal) {
        const terminal = res.settings.terminal;
        const fontFamily = terminal.fontFamily ?? DEFAULTS.fontFamily;
        setSettings({ fontFamily });
        savedValueRef.current = fontFamily;
      } else {
        setSettings(DEFAULTS);
        savedValueRef.current = DEFAULTS.fontFamily;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    const trimmed = settings.fontFamily.trim();
    if (trimmed === savedValueRef.current) {
      setIsDirty(false);
      return;
    }
    const res = await window.electronAPI.updateSettings({ terminal: { fontFamily: trimmed } });
    if (res?.success && res.settings?.terminal) {
      const terminal = res.settings.terminal;
      const fontFamily = terminal.fontFamily ?? DEFAULTS.fontFamily;
      setSettings({ fontFamily });
      savedValueRef.current = fontFamily;
      window.dispatchEvent(
        new CustomEvent('terminal-font-changed', {
          detail: { fontFamily: terminal.fontFamily },
        })
      );
    }
    setIsDirty(false);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 1500);
  }, [settings.fontFamily]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSettings((s) => ({ ...s, fontFamily: value }));
    setShowSaved(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="grid gap-1">
      <div className="relative">
        <Input
          value={settings.fontFamily}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsDirty(true)}
          onBlur={() => void save()}
          placeholder="Font Name"
          aria-label="Terminal font family"
          disabled={loading}
          className="pr-24"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          <AnimatePresence mode="wait">
            {isDirty && (
              <motion.div
                key="hint"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-1"
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSettings((s) => ({ ...s, fontFamily: '' }));
                  }}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors"
                  aria-label="Clear input"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" />
                  Save
                </span>
              </motion.div>
            )}
            {!isDirty && showSaved && (
              <motion.div
                key="check"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <Check className="h-4 w-4 text-green-500" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Use a custom terminal font from your device (e.g., MesloLGS NF)
      </div>
    </div>
  );
};

export default TerminalSettingsCard;
