import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Spinner } from '../ui/spinner';
import { cn } from '@/lib/utils';
import { FolderOpen, Eye, EyeOff, Server, User, Lock, Key, Shield, Download } from 'lucide-react';
import { useSshConnections } from '../../hooks/useSshConnections';
import type { SshConfig, SshConfigHost } from '@shared/ssh/types';

export interface SshConnectionConfig extends Omit<SshConfig, 'id'> {
  password?: string;
  passphrase?: string;
}

interface ValidationErrors {
  name?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  [key: string]: string | undefined;
}

interface Props {
  initialValues?: Partial<SshConnectionConfig>;
  onSubmit: (config: SshConnectionConfig) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export const SshConnectionForm: React.FC<Props> = ({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const { getSshConfigHost } = useSshConnections();

  const [formData, setFormData] = useState<SshConnectionConfig>({
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: '',
    ...initialValues,
  });

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isLoadingFromConfig, setIsLoadingFromConfig] = useState(false);
  const [showConfigSuggestions, setShowConfigSuggestions] = useState(false);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [hostMatches, setHostMatches] = useState<SshConfigHost[]>([]);

  // Load SSH config hosts on mount
  useEffect(() => {
    const loadSshConfigHosts = async () => {
      try {
        const result = (await window.electronAPI.sshGetConfig()) as {
          success: boolean;
          hosts?: Array<{
            host: string;
            hostname?: string;
            user?: string;
            port?: number;
            identityFile?: string;
            identityAgent?: string;
          }>;
          error?: string;
        };

        if (result.success && result.hosts) {
          setSshConfigHosts(result.hosts);
        }
      } catch (err) {
        console.warn('Failed to load SSH config hosts:', err);
      }
    };

    loadSshConfigHosts();
  }, []);

  // Update host suggestions when user types in host field
  useEffect(() => {
    if (formData.host.trim().length > 0) {
      const matches = sshConfigHosts.filter((h) =>
        h.host.toLowerCase().includes(formData.host.toLowerCase())
      );
      setHostMatches(matches);
      setShowConfigSuggestions(matches.length > 0);
    } else {
      setHostMatches([]);
      setShowConfigSuggestions(false);
    }
  }, [formData.host, sshConfigHosts]);

  // Reset form when initialValues change
  useEffect(() => {
    if (initialValues) {
      setFormData((prev) => ({
        ...prev,
        ...initialValues,
      }));
    }
  }, [initialValues]);

  // Apply SSH config host settings to form
  const applyConfigHost = useCallback(async (host: SshConfigHost) => {
    try {
      setIsLoadingFromConfig(true);

      // Determine auth type based on config
      let authType: 'password' | 'key' | 'agent' = 'agent';
      let privateKeyPath = '';

      if (host.identityAgent) {
        // IdentityAgent signals the user wants agent-based auth (e.g. 1Password)
        authType = 'agent';
      } else if (host.identityFile) {
        authType = 'key';
        privateKeyPath = host.identityFile;
      }

      // Apply settings to form
      setFormData((prev) => ({
        ...prev,
        host: host.hostname || host.host,
        port: host.port || 22,
        username: host.user || '',
        authType,
        privateKeyPath,
        // Keep existing name if set, otherwise use host alias
        name: prev.name || `${host.host} (from SSH config)`,
      }));

      // Hide suggestions
      setShowConfigSuggestions(false);
    } catch (err) {
      console.error('Failed to apply SSH config:', err);
    } finally {
      setIsLoadingFromConfig(false);
    }
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.name?.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.host?.trim()) {
      newErrors.host = 'Host is required';
    }

    if (!formData.port || formData.port < 1 || formData.port > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }

    if (!formData.username?.trim()) {
      newErrors.username = 'Username is required';
    }

    if (formData.authType === 'password' && !formData.password?.trim()) {
      newErrors.password = 'Password is required';
    }

    if (formData.authType === 'key') {
      if (!formData.privateKeyPath?.trim()) {
        newErrors.privateKeyPath = 'Private key path is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (validate()) {
        onSubmit(formData);
      }
    },
    [formData, onSubmit, validate]
  );

  const handleChange = useCallback(
    (field: keyof SshConnectionConfig, value: string | number) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear error when user starts typing
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [errors]
  );

  const handleSelectKeyFile = useCallback(async () => {
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        handleChange('privateKeyPath', result.path);
      }
    } catch (error) {
      console.error('Failed to select key file:', error);
    }
  }, [handleChange]);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Connection Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Connection Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="name"
          type="text"
          placeholder="e.g., Production Server"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className={cn(errors.name && 'border-red-500 focus-visible:ring-red-500')}
        />
        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
      </div>

      {/* Host and Port */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="host">
            Host <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Server className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="host"
              type="text"
              placeholder="e.g., 192.168.1.100 or server.example.com"
              value={formData.host}
              onChange={(e) => handleChange('host', e.target.value)}
              onFocus={() =>
                formData.host.trim().length > 0 && setShowConfigSuggestions(hostMatches.length > 0)
              }
              className={cn('pl-10', errors.host && 'border-red-500 focus-visible:ring-red-500')}
            />

            {/* SSH Config suggestions dropdown */}
            {showConfigSuggestions && hostMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  Found in ~/.ssh/config
                </div>
                {hostMatches.map((match) => (
                  <button
                    key={match.host}
                    type="button"
                    onClick={() => applyConfigHost(match)}
                    disabled={isLoadingFromConfig}
                    className="group flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{match.host}</span>
                      {match.hostname && (
                        <span className="text-xs text-muted-foreground">
                          {match.hostname}:{match.port || 22} • {match.user || 'unknown'}
                        </span>
                      )}
                    </div>
                    <Download className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
          {errors.host && <p className="text-xs text-red-500">{errors.host}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            min={1}
            max={65535}
            value={formData.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value, 10) || 22)}
            className={cn(errors.port && 'border-red-500 focus-visible:ring-red-500')}
          />
          {errors.port && <p className="text-xs text-red-500">{errors.port}</p>}
        </div>
      </div>

      {/* Username */}
      <div className="space-y-2">
        <Label htmlFor="username">
          Username <span className="text-red-500">*</span>
        </Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="username"
            type="text"
            placeholder="e.g., ubuntu"
            value={formData.username}
            onChange={(e) => handleChange('username', e.target.value)}
            className={cn('pl-10', errors.username && 'border-red-500 focus-visible:ring-red-500')}
          />
        </div>
        {errors.username && <p className="text-xs text-red-500">{errors.username}</p>}
      </div>

      {/* Auth Type */}
      <div className="space-y-3">
        <Label>Authentication Method</Label>
        <RadioGroup
          value={formData.authType}
          onValueChange={(value: 'password' | 'key' | 'agent') => handleChange('authType', value)}
          className="flex flex-col gap-3"
        >
          <div className="flex items-center space-x-2 rounded-lg border border-border p-3 hover:bg-muted/50">
            <RadioGroupItem value="password" id="auth-password" />
            <Label
              htmlFor="auth-password"
              className="flex cursor-pointer items-center gap-2 font-normal"
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="font-medium">Password</span>
                <p className="text-xs text-muted-foreground">Authenticate using a password</p>
              </div>
            </Label>
          </div>

          <div className="flex items-center space-x-2 rounded-lg border border-border p-3 hover:bg-muted/50">
            <RadioGroupItem value="key" id="auth-key" />
            <Label
              htmlFor="auth-key"
              className="flex cursor-pointer items-center gap-2 font-normal"
            >
              <Key className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="font-medium">SSH Key</span>
                <p className="text-xs text-muted-foreground">Use a private key file (PEM, KEY)</p>
              </div>
            </Label>
          </div>

          <div className="flex items-center space-x-2 rounded-lg border border-border p-3 hover:bg-muted/50">
            <RadioGroupItem value="agent" id="auth-agent" />
            <Label
              htmlFor="auth-agent"
              className="flex cursor-pointer items-center gap-2 font-normal"
            >
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="font-medium">SSH Agent</span>
                <p className="text-xs text-muted-foreground">Use the system SSH agent</p>
              </div>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Conditional Fields based on Auth Type */}
      {formData.authType === 'password' && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={formData.password || ''}
              onChange={(e) => handleChange('password', e.target.value)}
              className={cn(
                'pl-10 pr-10',
                errors.password && 'border-red-500 focus-visible:ring-red-500'
              )}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
        </div>
      )}

      {formData.authType === 'key' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privateKeyPath">Private Key Path</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="privateKeyPath"
                  type="text"
                  placeholder="/home/user/.ssh/id_rsa"
                  value={formData.privateKeyPath || ''}
                  onChange={(e) => handleChange('privateKeyPath', e.target.value)}
                  className={cn(
                    'pl-10',
                    errors.privateKeyPath && 'border-red-500 focus-visible:ring-red-500'
                  )}
                />
              </div>
              <Button type="button" variant="outline" size="icon" onClick={handleSelectKeyFile}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {errors.privateKeyPath && (
              <p className="text-xs text-red-500">{errors.privateKeyPath}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="passphrase">Key Passphrase (optional)</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="passphrase"
                type={showPassphrase ? 'text' : 'password'}
                placeholder="Enter passphrase if your key is encrypted"
                value={formData.passphrase || ''}
                onChange={(e) => handleChange('passphrase', e.target.value)}
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Saving...
            </>
          ) : (
            'Save Connection'
          )}
        </Button>
      </div>
    </form>
  );
};

export default SshConnectionForm;
