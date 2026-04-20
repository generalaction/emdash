import React, { useEffect, useState } from 'react';
import { Copy, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from './ui/button';

type MobileInfo = {
  enabled: boolean;
  port: number;
  pin: string;
  urls: string[];
};

const MobileAccessSettingsCard: React.FC = () => {
  const [info, setInfo] = useState<MobileInfo | null>(null);
  const [pinVisible, setPinVisible] = useState(false);
  const [copied, setCopied] = useState('');

  const refresh = () => {
    window.electronAPI
      .mobileGetInfo()
      .then(setInfo)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-100">Mobile Access</h3>
        <button
          onClick={refresh}
          className="ml-auto text-neutral-500 hover:text-neutral-300"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {!info ? (
        <p className="text-xs text-neutral-500">Loading…</p>
      ) : !info.enabled ? (
        <p className="text-xs text-neutral-500">Mobile server is not running.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-400">
            Open one of the URLs below on your phone and enter the PIN to access active terminals
            from your browser.
          </p>

          {/* URLs */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-neutral-300">Network URLs</p>
            {info.urls.length === 0 ? (
              <p className="text-xs text-neutral-500">No LAN interfaces detected.</p>
            ) : (
              info.urls.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-emerald-400">
                    {url}
                  </code>
                  <button
                    onClick={() => copy(url, url)}
                    className="text-neutral-500 hover:text-neutral-300"
                    title="Copy URL"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied === url && <span className="text-xs text-emerald-400">Copied</span>}
                </div>
              ))
            )}
          </div>

          {/* PIN */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">PIN</p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-neutral-800 px-3 py-1 text-sm tracking-widest text-violet-300">
                {pinVisible ? info.pin : '••••••'}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPinVisible((v) => !v)}
              >
                {pinVisible ? 'Hide' : 'Show'}
              </Button>
              <button
                onClick={() => copy(info.pin, 'pin')}
                className="text-neutral-500 hover:text-neutral-300"
                title="Copy PIN"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {copied === 'pin' && <span className="text-xs text-emerald-400">Copied</span>}
            </div>
            <p className="mt-1 text-xs text-neutral-500">PIN resets each time Emdash restarts.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileAccessSettingsCard;
