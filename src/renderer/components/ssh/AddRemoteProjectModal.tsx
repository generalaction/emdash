import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '../ui/button';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { rpc } from '../../lib/rpc';
import { Spinner } from '../ui/spinner';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { RadioGroup } from '../ui/radio-group';
import { cn } from '@/lib/utils';
import type { SshConfig, ConnectionTestResult } from '@shared/ssh/types';
import {
  Server,
  Key,
  Lock,
  User,
  FolderOpen,
  Check,
  ChevronRight,
  ChevronLeft,
  FileCode,
  AlertCircle,
  Globe,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Loader2,
  Shield,
  Trash,
  Copy,
} from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';

type WizardStep = 'connection' | 'auth' | 'path' | 'confirm';
type AuthType = 'password' | 'key' | 'agent';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface AddRemoteProjectModalProps {
  onClose: () => void;
  onSuccess: (project: {
    id: string;
    name: string;
    path: string;
    host: string;
    connectionId: string;
  }) => void;
}

interface FormData {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  remotePath: string;
}

interface FormErrors {
  name?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  remotePath?: string;
  general?: string;
}

export const AddRemoteProjectModal: React.FC<AddRemoteProjectModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('connection');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [debugLogsOpen, setDebugLogsOpen] = useState(false);
  const [debugLogsCopied, setDebugLogsCopied] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [savedConnections, setSavedConnections] = useState<
    Array<{
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      authType: AuthType;
      privateKeyPath?: string;
      useAgent?: boolean;
    }>
  >([]);
  const [isLoadingSavedConnections, setIsLoadingSavedConnections] = useState(false);
  const [selectedSavedConnection, setSelectedSavedConnection] = useState<string | null>(null);
  const [useExistingConnection, setUseExistingConnection] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: '',
    remotePath: '',
  });

  useEffect(() => {
    setCurrentStep('connection');
    setFormData({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyPath: '',
      passphrase: '',
      remotePath: '',
    });
    setErrors({});
    setTouched({});
    setTestStatus('idle');
    setTestResult(null);
    setDebugLogs([]);
    setDebugLogsOpen(false);
    setDebugLogsCopied(false);
    setSavedConnections([]);
    setSelectedSavedConnection(null);
    setUseExistingConnection(false);

    void loadSavedConnections();

    import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('remote_project_modal_opened');
    });
  }, []);

  const loadSavedConnections = useCallback(async () => {
    setIsLoadingSavedConnections(true);
    try {
      const connections = await rpc.ssh.getConnections();
      setSavedConnections(connections as typeof savedConnections);
    } catch (error) {
      console.debug('Failed to load saved connections:', error);
    } finally {
      setIsLoadingSavedConnections(false);
    }
  }, []);

  const deleteSavedConnection = useCallback(
    async (id: string) => {
      try {
        await rpc.ssh.deleteConnection(id);
        if (selectedSavedConnection === id) {
          setSelectedSavedConnection(null);
          setUseExistingConnection(false);
        }
        await loadSavedConnections();
      } catch (error) {
        console.error('Failed to delete connection:', error);
      }
    },
    [selectedSavedConnection, loadSavedConnections]
  );

  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [errors]
  );

  const touchField = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const validateStep = useCallback(
    (step: WizardStep): boolean => {
      const newErrors: FormErrors = {};

      switch (step) {
        case 'connection':
          if (!formData.name.trim()) {
            newErrors.name = 'Connection name is required';
          }
          if (!formData.host.trim()) {
            newErrors.host = 'Host is required';
          } else if (
            !/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(formData.host.trim()) &&
            !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(formData.host.trim()) &&
            !/^[a-zA-Z0-9_-]+$/.test(formData.host.trim())
          ) {
            newErrors.host = 'Please enter a valid hostname, IP address, or SSH alias';
          }
          if (!formData.username.trim()) {
            newErrors.username = 'Username is required';
          }
          if (formData.port < 1 || formData.port > 65535) {
            newErrors.port = 'Port must be between 1 and 65535';
          }
          break;

        case 'auth':
          if (formData.authType === 'password' && !formData.password) {
            newErrors.password = 'Password is required';
          }
          if (formData.authType === 'key' && !formData.privateKeyPath) {
            newErrors.privateKeyPath = 'Private key path is required';
          }
          break;

        case 'path':
          if (!formData.remotePath.trim()) {
            newErrors.remotePath = 'Remote path is required';
          } else if (!formData.remotePath.startsWith('/')) {
            newErrors.remotePath = 'Path must be absolute (start with /)';
          }
          break;
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [formData]
  );

  const testConnection = useCallback(async (): Promise<boolean> => {
    setErrors((prev) => ({ ...prev, general: undefined }));
    setTestStatus('testing');
    setTestResult(null);

    try {
      const testConfig: SshConfig & { password?: string; passphrase?: string } = {
        name: formData.name,
        host: formData.host,
        port: formData.port,
        username: formData.username,
        authType: formData.authType,
        privateKeyPath: formData.privateKeyPath || undefined,
        useAgent: formData.authType === 'agent',
        password: formData.authType === 'password' ? formData.password : undefined,
        passphrase: formData.authType === 'key' ? formData.passphrase || undefined : undefined,
      };

      const result = await rpc.ssh.testConnection(testConfig);
      setTestResult(result);
      setDebugLogs(result.debugLogs || []);

      import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('remote_project_connection_tested', { success: result.success });
      });

      if (result.success) {
        setTestStatus('success');
        setErrors((prev) => ({ ...prev, general: undefined }));
        return true;
      } else {
        setTestStatus('error');

        let errorMsg = result.error || 'Connection failed';
        let suggestKeyAuth = false;

        if (formData.authType === 'agent') {
          errorMsg =
            'SSH agent authentication failed. Switched to SSH Key authentication - select a key file below from common options.';
          suggestKeyAuth = true;
        } else if (formData.authType === 'key' && errorMsg.includes('Failed to read private key')) {
          errorMsg = `Cannot read key file: ${formData.privateKeyPath}. Verify it exists and has read permissions (chmod 600).`;
        } else if (errorMsg.includes('Authentication failed') && formData.authType === 'key') {
          errorMsg =
            'Authentication failed. Verify the correct key file is being used and the public key is in ~/.ssh/authorized_keys on the server.';
        }

        setErrors((prev) => ({ ...prev, general: errorMsg }));

        if (suggestKeyAuth && formData.authType === 'agent') {
          setFormData((prev) => ({ ...prev, authType: 'key' }));
        }
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setTestStatus('error');
      setTestResult({ success: false, error: message });
      setErrors((prev) => ({ ...prev, general: message }));
      return false;
    }
  }, [formData]);

  const selectExistingConnection = useCallback((conn: (typeof savedConnections)[number]) => {
    setSelectedSavedConnection(conn.id);
    setUseExistingConnection(true);
    setErrors({});

    setFormData((prev) => ({
      ...prev,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType,
      privateKeyPath: conn.privateKeyPath || '',
    }));

    setCurrentStep('path');
  }, []);

  const handleNext = useCallback(async () => {
    if (!validateStep(currentStep)) return;

    if (currentStep === 'auth') {
      const success = await testConnection();
      if (!success) return;
    }

    const stepOrder: WizardStep[] = useExistingConnection
      ? ['connection', 'path', 'confirm']
      : ['connection', 'auth', 'path', 'confirm'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    }
  }, [currentStep, validateStep, testConnection, useExistingConnection]);

  const handleBack = useCallback(() => {
    if (useExistingConnection && currentStep === 'path') {
      setUseExistingConnection(false);
      setSelectedSavedConnection(null);
      setCurrentStep('connection');
      return;
    }
    const stepOrder: WizardStep[] = useExistingConnection
      ? ['connection', 'path', 'confirm']
      : ['connection', 'auth', 'path', 'confirm'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
  }, [currentStep, useExistingConnection]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep('path')) return;

    setIsSubmitting(true);

    try {
      const projectName = formData.remotePath.split('/').filter(Boolean).pop() || formData.name;

      if (useExistingConnection && selectedSavedConnection) {
        onSuccess({
          id: Date.now().toString(),
          name: projectName,
          path: formData.remotePath,
          host: formData.host,
          connectionId: selectedSavedConnection,
        });
      } else {
        const saveConfig: SshConfig & { password?: string; passphrase?: string } = {
          name: formData.name,
          host: formData.host,
          port: formData.port,
          username: formData.username,
          authType: formData.authType,
          privateKeyPath: formData.privateKeyPath || undefined,
          useAgent: formData.authType === 'agent',
          password: formData.authType === 'password' ? formData.password : undefined,
          passphrase: formData.authType === 'key' ? formData.passphrase || undefined : undefined,
        };

        const saved = await rpc.ssh.saveConnection(saveConfig);

        onSuccess({
          id: Date.now().toString(),
          name: projectName,
          path: formData.remotePath,
          host: formData.host,
          connectionId: saved.id!,
        });
      }

      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save connection';
      setErrors((prev) => ({ ...prev, general: message }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateStep, onSuccess, onClose, useExistingConnection, selectedSavedConnection]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const steps: { id: WizardStep; label: string; icon: React.ElementType }[] = useExistingConnection
    ? [
        { id: 'connection', label: 'Connection', icon: Server },
        { id: 'path', label: 'Project Path', icon: FolderOpen },
        { id: 'confirm', label: 'Confirm', icon: Check },
      ]
    : [
        { id: 'connection', label: 'Connection', icon: Server },
        {
          id: 'auth',
          label: 'Authentication',
          icon: formData.authType === 'password' ? Lock : Key,
        },
        { id: 'path', label: 'Project Path', icon: FolderOpen },
        { id: 'confirm', label: 'Confirm', icon: Check },
      ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const renderStepContent = () => {
    switch (currentStep) {
      case 'connection':
        return (
          <div className="space-y-4">
            {isLoadingSavedConnections ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading saved connections...
              </div>
            ) : savedConnections.length > 0 ? (
              <div className="space-y-2">
                <Label>Saved Connections</Label>
                <div className="space-y-2">
                  {savedConnections.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => selectExistingConnection(conn)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent',
                        selectedSavedConnection === conn.id && 'border-primary bg-primary/5'
                      )}
                    >
                      <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{conn.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {conn.username}@{conn.host}:{conn.port}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteSavedConnection(conn.id);
                        }}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                <div className="relative py-2">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
                    Or create a new connection
                  </span>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="name">
                Connection Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                onBlur={() => touchField('name')}
                placeholder="My Remote Server"
                className={cn(errors.name && touched.name && 'border-destructive')}
              />
              {errors.name && touched.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="host">
                  Host <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="host"
                    value={formData.host}
                    onChange={(e) => updateField('host', e.target.value)}
                    onBlur={() => touchField('host')}
                    placeholder="server.example.com or SSH alias"
                    className={cn('pl-10', errors.host && touched.host && 'border-destructive')}
                  />
                </div>
                {errors.host && touched.host && (
                  <p className="text-xs text-destructive">{errors.host}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => updateField('port', parseInt(e.target.value) || 22)}
                  min={1}
                  max={65535}
                  className={cn(errors.port && 'border-destructive')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">
                Username <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  onBlur={() => touchField('username')}
                  placeholder="user"
                  className={cn(
                    'pl-10',
                    errors.username && touched.username && 'border-destructive'
                  )}
                />
              </div>
              {errors.username && touched.username && (
                <p className="text-xs text-destructive">{errors.username}</p>
              )}
            </div>
          </div>
        );

      case 'auth':
        return (
          <div className="space-y-4">
            {formData.authType === 'key' && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="mb-2 text-sm font-medium">Quick select common SSH keys:</p>
                  <div className="space-y-1 text-xs">
                    {[
                      { name: 'id_ed25519', path: '~/.ssh/id_ed25519' },
                      { name: 'id_rsa', path: '~/.ssh/id_rsa' },
                      { name: 'id_ecdsa', path: '~/.ssh/id_ecdsa' },
                    ].map((key) => (
                      <button
                        key={key.name}
                        type="button"
                        onClick={() => updateField('privateKeyPath', key.path)}
                        className="block text-left font-medium text-foreground hover:underline"
                      >
                        {key.path}
                      </button>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <Label>Authentication Method</Label>
              <RadioGroup
                value={formData.authType}
                onValueChange={(value) => updateField('authType', value as AuthType)}
                className="grid grid-cols-3 gap-3"
              >
                <div>
                  <input
                    type="radio"
                    value="password"
                    id="auth-password"
                    name="authType"
                    className="sr-only"
                    checked={formData.authType === 'password'}
                    onChange={() => updateField('authType', 'password')}
                  />
                  <Label
                    htmlFor="auth-password"
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary',
                      formData.authType === 'password' && 'border-primary'
                    )}
                  >
                    <Lock className="mb-3 h-6 w-6" />
                    <span className="text-sm font-medium">Password</span>
                  </Label>
                </div>

                <div>
                  <input
                    type="radio"
                    value="key"
                    id="auth-key"
                    name="authType"
                    className="sr-only"
                    checked={formData.authType === 'key'}
                    onChange={() => updateField('authType', 'key')}
                  />
                  <Label
                    htmlFor="auth-key"
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary',
                      formData.authType === 'key' && 'border-primary'
                    )}
                  >
                    <FileCode className="mb-3 h-6 w-6" />
                    <span className="text-sm font-medium">SSH Key</span>
                  </Label>
                </div>

                <div>
                  <input
                    type="radio"
                    value="agent"
                    id="auth-agent"
                    name="authType"
                    className="sr-only"
                    checked={formData.authType === 'agent'}
                    onChange={() => updateField('authType', 'agent')}
                  />
                  <Label
                    htmlFor="auth-agent"
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary',
                      formData.authType === 'agent' && 'border-primary'
                    )}
                  >
                    <Shield className="mb-3 h-6 w-6" />
                    <span className="text-sm font-medium">Agent</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {formData.authType === 'password' && (
              <div className="space-y-2">
                <Label htmlFor="password">
                  Password <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  onBlur={() => touchField('password')}
                  placeholder="Enter your password"
                  className={cn(errors.password && touched.password && 'border-destructive')}
                />
                {errors.password && touched.password && (
                  <p className="text-xs text-destructive">{errors.password}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your password will be securely stored in the system keychain.
                </p>
              </div>
            )}

            {formData.authType === 'key' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="private-key">
                    Private Key Path <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="private-key"
                      value={formData.privateKeyPath}
                      onChange={(e) => updateField('privateKeyPath', e.target.value)}
                      onBlur={() => touchField('privateKeyPath')}
                      placeholder="~/.ssh/id_rsa"
                      className={cn(
                        errors.privateKeyPath && touched.privateKeyPath && 'border-destructive'
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const result = await rpc.project.open();
                          if (result.success && result.path) {
                            updateField('privateKeyPath', result.path);
                          }
                        } catch {
                          // Ignore
                        }
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                  {errors.privateKeyPath && touched.privateKeyPath && (
                    <p className="text-xs text-destructive">{errors.privateKeyPath}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="passphrase">Passphrase (optional)</Label>
                  <Input
                    id="passphrase"
                    type="password"
                    value={formData.passphrase}
                    onChange={(e) => updateField('passphrase', e.target.value)}
                    placeholder="Leave empty if no passphrase"
                  />
                  <p className="text-xs text-muted-foreground">
                    If your key is encrypted, enter the passphrase here.
                  </p>
                </div>
              </div>
            )}

            {formData.authType === 'agent' && (
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <p>
                      SSH Agent authentication uses your system&apos;s SSH agent. Ensure your key is
                      loaded before connecting.
                    </p>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-semibold text-foreground">
                        How to set up SSH agent
                      </summary>
                      <div className="mt-2 space-y-1 font-mono text-xs">
                        <p>1. Start SSH agent (if not running):</p>
                        <p className="pl-2 text-muted-foreground">
                          eval &quot;$(ssh-agent -s)&quot;
                        </p>
                        <p className="pt-1">2. Check if your key is loaded:</p>
                        <p className="pl-2 text-muted-foreground">ssh-add -l</p>
                        <p className="pt-1">3. If not listed, add your key:</p>
                        <p className="pl-2 text-muted-foreground">ssh-add ~/.ssh/id_ed25519</p>
                        <p className="pt-1">(or your key filename if different)</p>
                      </div>
                    </details>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {testStatus !== 'idle' && (
              <Badge
                variant="outline"
                className={cn(
                  'w-full justify-start gap-2 py-1.5',
                  testStatus === 'success' && 'border-emerald-500/40 bg-emerald-500/10',
                  testStatus === 'error' && 'border-destructive/40 bg-destructive/10'
                )}
              >
                {testStatus === 'testing' && <Loader2 className="h-3 w-3 animate-spin" />}
                {testStatus === 'success' && (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                )}
                {testStatus === 'error' && (
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <span className="whitespace-pre-wrap break-words">
                  {testStatus === 'testing' && 'Testing connection...'}
                  {testStatus === 'success' &&
                    `Connected successfully${testResult?.latency ? ` (${testResult.latency}ms)` : ''}`}
                  {testStatus === 'error' && (testResult?.error || 'Connection failed')}
                </span>
              </Badge>
            )}

            {debugLogs.length > 0 && (
              <Collapsible open={debugLogsOpen} onOpenChange={setDebugLogsOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&[data-state=open]>svg:first-child]:rotate-180">
                  <ChevronDown className="h-3 w-3 transition-transform duration-200" />
                  Show connection debug log ({debugLogs.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(debugLogs.join('\n'));
                          setDebugLogsCopied(true);
                          setTimeout(() => setDebugLogsCopied(false), 2000);
                        } catch {
                          // Clipboard access may be denied
                        }
                      }}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      aria-label="Copy debug log"
                    >
                      {debugLogsCopied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {debugLogsCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="max-h-[200px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {debugLogs.join('\n')}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        );

      case 'path':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="remote-path">
                Project Path <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <FolderOpen className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="remote-path"
                  value={formData.remotePath}
                  onChange={(e) => updateField('remotePath', e.target.value)}
                  onBlur={() => touchField('remotePath')}
                  placeholder="/home/user/myproject"
                  className={cn(
                    'pl-10',
                    errors.remotePath && touched.remotePath && 'border-destructive'
                  )}
                />
              </div>
              {errors.remotePath && touched.remotePath && (
                <p className="text-xs text-destructive">{errors.remotePath}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Enter the absolute path to your project on the remote server.
              </p>
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <Badge
              variant="outline"
              className="w-full justify-start gap-2 border-emerald-500/40 bg-emerald-500/10 py-1.5"
            >
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
              <span>Please review your configuration before saving.</span>
            </Badge>

            <div className="rounded-md border">
              <div className="border-b bg-muted/50 px-4 py-2 text-sm font-medium">
                Connection Summary
              </div>
              <div className="divide-y">
                <div className="flex px-4 py-3">
                  <span className="w-32 shrink-0 text-sm text-muted-foreground">Name</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {formData.name}
                  </span>
                </div>
                <div className="flex px-4 py-3">
                  <span className="w-32 shrink-0 text-sm text-muted-foreground">Host</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {formData.username}@{formData.host}:{formData.port}
                  </span>
                </div>
                <div className="flex px-4 py-3">
                  <span className="w-32 shrink-0 text-sm text-muted-foreground">
                    Authentication
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {formData.authType === 'password' && 'Password'}
                    {formData.authType === 'key' && 'SSH Key'}
                    {formData.authType === 'agent' && 'SSH Agent'}
                  </span>
                </div>
                <div className="flex px-4 py-3">
                  <span className="w-32 shrink-0 text-sm text-muted-foreground">Project Path</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                    {formData.remotePath}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {useExistingConnection
                ? 'The existing connection will be reused for this project.'
                : "The connection will be saved and you'll be able to access this project from the workspace."}
            </p>
          </div>
        );
    }
  };

  return (
    <DialogContent
      className="max-w-lg md:max-w-2xl"
      onInteractOutside={(e) => {
        if (isSubmitting) e.preventDefault();
        else handleClose();
      }}
      onEscapeKeyDown={(e) => {
        if (isSubmitting) e.preventDefault();
        else handleClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add Remote Project</DialogTitle>
        <DialogDescription>
          Connect to a remote server via SSH to work on your project.
        </DialogDescription>
      </DialogHeader>

      <Separator />

      <div className="flex items-center gap-2 py-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === currentStepIndex;
          const isCompleted = index < currentStepIndex;

          return (
            <React.Fragment key={step.id}>
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-sm border-2 text-xs font-medium',
                  isActive && 'border-primary bg-primary text-primary-foreground',
                  isCompleted && 'border-primary bg-primary/10 text-primary',
                  !isActive && !isCompleted && 'border-muted text-muted-foreground'
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              {index < steps.length - 1 && (
                <ChevronRight
                  className={cn('h-4 w-4', isCompleted ? 'text-primary' : 'text-muted-foreground')}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div>
        <h3 className="text-lg font-medium">{steps[currentStepIndex]?.label}</h3>
      </div>

      {errors.general && currentStep !== 'auth' && (
        <Badge
          variant="outline"
          className="w-full justify-start gap-2 border-destructive/40 bg-destructive/10 py-1.5"
        >
          <XCircle className="h-3 w-3 shrink-0 text-destructive" />
          <span className="whitespace-pre-wrap break-words">{errors.general}</span>
        </Badge>
      )}

      <div className="min-w-0 py-2">{renderStepContent()}</div>

      <div
        className={cn(
          'flex gap-2',
          currentStep === 'connection' ? 'justify-end' : 'justify-between'
        )}
      >
        <Button
          type="button"
          variant="outline"
          onClick={currentStep === 'connection' ? onClose : handleBack}
          disabled={isSubmitting}
        >
          {currentStep === 'connection' ? (
            'Cancel'
          ) : (
            <>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </>
          )}
        </Button>

        {currentStep === 'confirm' ? (
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-1 h-4 w-4" />
                {useExistingConnection ? 'Add Project' : 'Save Connection'}
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => void handleNext()}
            disabled={isSubmitting || (currentStep === 'auth' && testStatus === 'testing')}
          >
            {currentStep === 'auth' && testStatus === 'testing' ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </DialogContent>
  );
};

export default AddRemoteProjectModal;
