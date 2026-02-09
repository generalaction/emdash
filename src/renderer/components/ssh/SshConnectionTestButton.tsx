import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '@/lib/utils';
import { Play, CheckCircle2, XCircle, Zap } from 'lucide-react';
import type { ConnectionTestResult } from '@shared/ssh/types';

type TestState = 'idle' | 'testing' | 'success' | 'error';

interface Props {
  connectionId: string;
  onResult?: (result: { success: boolean; message?: string }) => void;
  size?: 'sm' | 'default' | 'lg' | 'icon' | 'icon-sm';
  variant?: 'default' | 'outline' | 'ghost';
}

export const SshConnectionTestButton: React.FC<Props> = ({
  connectionId,
  onResult,
  size = 'default',
  variant = 'outline',
}) => {
  const [testState, setTestState] = useState<TestState>('idle');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTest = useCallback(async () => {
    setTestState('testing');
    setResult(null);
    setErrorMessage(null);

    try {
      // For testing, we need the full config - this would need to be fetched or passed in
      // For now, we'll call the test with just the ID and let the main process handle it
      // TODO: Fetch connection details or update IPC to accept just ID
      const testResult = await window.electronAPI.sshTestConnection({
        id: connectionId,
        name: '',
        host: '',
        port: 22,
        username: '',
        authType: 'password',
      });

      setResult(testResult);

      if (testResult.success) {
        setTestState('success');
        onResult?.({ success: true, message: `Connected successfully` });
      } else {
        setTestState('error');
        setErrorMessage(testResult.error || 'Connection failed');
        onResult?.({ success: false, message: testResult.error });
      }

      // Reset to idle after 3 seconds on success
      if (testResult.success) {
        setTimeout(() => {
          setTestState('idle');
          setResult(null);
        }, 3000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setTestState('error');
      setErrorMessage(message);
      onResult?.({ success: false, message });
    }
  }, [connectionId, onResult]);

  const getButtonContent = () => {
    switch (testState) {
      case 'testing':
        return (
          <>
            <Spinner size="sm" className="mr-2" />
            <span>Testing...</span>
          </>
        );
      case 'success':
        return (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
            <span>Connected</span>
            {result?.latency && (
              <span className="ml-1 flex items-center text-xs text-muted-foreground">
                <Zap className="mr-0.5 h-3 w-3" />
                {result.latency}ms
              </span>
            )}
          </>
        );
      case 'error':
        return (
          <>
            <XCircle className="mr-2 h-4 w-4 text-red-500" />
            <span>Failed</span>
          </>
        );
      default:
        return (
          <>
            <Play className="mr-2 h-4 w-4" />
            <span>Test</span>
          </>
        );
    }
  };

  const getButtonClass = () => {
    switch (testState) {
      case 'success':
        return 'border-emerald-500/50 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30';
      case 'error':
        return 'border-red-500/50 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleTest}
        disabled={testState === 'testing'}
        aria-busy={testState === 'testing'}
        className={cn(getButtonClass())}
      >
        {getButtonContent()}
      </Button>

      {testState === 'error' && errorMessage && (
        <p className="max-w-[200px] text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </div>
  );
};

export default SshConnectionTestButton;
