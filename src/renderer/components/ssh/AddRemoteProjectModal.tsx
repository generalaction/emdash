import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Spinner } from '../ui/spinner';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { cn } from '@/lib/utils';
import type { SshConfig, ConnectionTestResult, FileEntry, SshConfigHost } from '@shared/ssh/types';
import {
  Server,
  Key,
  Lock,
  User,
  FolderOpen,
  Check,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  FileCode,
  AlertCircle,
  Globe,
  CheckCircle2,
  XCircle,
  Folder,
  ChevronUp,
  ChevronDown,
  Loader2,
  Shield,
  Trash,
  Plus,
  GitBranch,
  Download,
  Copy,
} from 'lucide-react';

type WizardStep = 'connection' | 'auth' | 'path' | 'confirm';
type AuthType = 'password' | 'key' | 'agent';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type RepoMode = 'pick' | 'create' | 'clone';

interface AddRemoteProjectModalProps {
  isOpen: boolean;
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
  // Connection step
  name: string;
  host: string;
  port: number;
  username: string;

  // Auth step
  authType: AuthType;
  password: string;
  privateKeyPath: string;
  passphrase: string;

  // Path step
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
  isOpen,
  onClose,
  onSuccess,
}) => {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('connection');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [debugLogsOpen, setDebugLogsOpen] = useState(false);
  const [debugLogsCopied, setDebugLogsCopied] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Path browsing state
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Repo mode state
  const [repoMode, setRepoMode] = useState<RepoMode>('pick');
  const [newRepoName, setNewRepoName] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDirName, setCloneDirName] = useState('');
  const [cloneDirManuallyEdited, setCloneDirManuallyEdited] = useState(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [isCloningRepo, setIsCloningRepo] = useState(false);

  // SSH config auto-detect state
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [isLoadingSshConfig, setIsLoadingSshConfig] = useState(false);
  const [sshConfigSelection, setSshConfigSelection] = useState<string>('');

  // Saved connections state (for reusing existing SSH connections)
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

  // Form data
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

  // Reset form when modal opens and load SSH config
  useEffect(() => {
    if (isOpen) {
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
      setFileEntries([]);
      setBrowseError(null);
      setConnectionId(null);
      setSshConfigSelection('');
      setSavedConnections([]);
      setSelectedSavedConnection(null);
      setUseExistingConnection(false);
      setRepoMode('pick');
      setNewRepoName('');
      setCloneUrl('');
      setCloneDirName('');
      setCloneDirManuallyEdited(false);
      setIsCreatingRepo(false);
      setIsCloningRepo(false);

      // Load SSH config hosts and saved connections
      void loadSshConfig();
      void loadSavedConnections();

      import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('remote_project_modal_opened');
      });
    }
  }, [isOpen]);

  // Load SSH config from ~/.ssh/config
  const loadSshConfig = useCallback(async () => {
    setIsLoadingSshConfig(true);
    try {
      const result = await window.electronAPI.sshGetConfig();
      if (result.success && result.hosts) {
        setSshConfigHosts(result.hosts);
      }
    } catch (error) {
      // Silently fail - SSH config is optional
      console.debug('Failed to load SSH config:', error);
    } finally {
      setIsLoadingSshConfig(false);
    }
  }, []);

  // Load saved SSH connections from database
  const loadSavedConnections = useCallback(async () => {
    setIsLoadingSavedConnections(true);
    try {
      const connections = await window.electronAPI.sshGetConnections();
      if (Array.isArray(connections)) {
        setSavedConnections(connections as typeof savedConnections);
      }
    } catch (error) {
      console.debug('Failed to load saved connections:', error);
    } finally {
      setIsLoadingSavedConnections(false);
    }
  }, []);

  const deleteSavedConnection = useCallback(
    async (id: string) => {
      try {
        await window.electronAPI.sshDeleteConnection(id);
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

  // Apply SSH config host selection
  const applySshHost = useCallback(
    (host: SshConfigHost) => {
      const stableId = `ssh-config:${encodeURIComponent(host.host)}`;
      setConnectionId(stableId);

      // Determine auth type and key path
      let authType: AuthType;
      let privateKeyPath = '';

      if (host.identityAgent) {
        // IdentityAgent signals the user wants agent-based auth (e.g. 1Password)
        authType = 'agent';
      } else if (host.identityFile) {
        // SSH config specifies a key - use it
        authType = 'key';
        privateKeyPath = host.identityFile;
      } else {
        // No key specified - default to key auth with ed25519 (most common modern key)
        authType = 'key';
        privateKeyPath = '~/.ssh/id_ed25519';
      }

      setFormData((prev) => ({
        ...prev,
        name: host.host, // Use the SSH host alias as connection name
        host: host.hostname || host.host,
        port: host.port || 22,
        username: host.user || prev.username,
        privateKeyPath,
        authType,
      }));
      setSshConfigSelection(host.host);

      // Clear any previous test results when host is changed
      setTestStatus('idle');
      setTestResult(null);
    },
    [setFormData]
  );

  // Update form field
  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear error when user starts typing
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [errors]
  );

  // Mark field as touched
  const touchField = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // Validate current step
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
            // Allow single-word SSH aliases like "lamb_clutha"
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
          if (repoMode === 'pick') {
            if (!formData.remotePath.trim()) {
              newErrors.remotePath = 'Remote path is required';
            } else if (!formData.remotePath.startsWith('/')) {
              newErrors.remotePath = 'Path must be absolute (start with /)';
            }
          } else if (repoMode === 'create') {
            if (!formData.remotePath.trim()) {
              newErrors.remotePath = 'Parent directory is required';
            } else if (!formData.remotePath.startsWith('/')) {
              newErrors.remotePath = 'Path must be absolute (start with /)';
            }
            if (!newRepoName.trim()) {
              newErrors.general = 'Repository name is required';
            } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(newRepoName.trim())) {
              newErrors.general =
                'Invalid name. Use letters, numbers, hyphens, underscores, dots. Must start with a letter or number.';
            }
          } else if (repoMode === 'clone') {
            if (!cloneUrl.trim()) {
              newErrors.general = 'Repository URL is required';
            } else {
              const patterns = [/^https?:\/\/.+/i, /^git@.+:.+/i, /^ssh:\/\/.+/i];
              if (!patterns.some((p) => p.test(cloneUrl.trim()))) {
                newErrors.general = 'Invalid URL. Use https://, git@, or ssh:// format.';
              }
            }
            if (!formData.remotePath.trim()) {
              newErrors.remotePath = 'Parent directory is required';
            } else if (!formData.remotePath.startsWith('/')) {
              newErrors.remotePath = 'Path must be absolute (start with /)';
            }
            if (!cloneDirName.trim()) {
              newErrors.general = newErrors.general || 'Directory name is required';
            }
          }
          break;
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [formData, repoMode, newRepoName, cloneUrl, cloneDirName]
  );

  // Test connection
  const testConnection = useCallback(async (): Promise<boolean> => {
    setErrors((prev) => ({ ...prev, general: undefined }));
    setTestStatus('testing');
    setTestResult(null);

    try {
      const testConfig: SshConfig & { password?: string; passphrase?: string } = {
        id: connectionId || undefined,
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

      const result = await window.electronAPI.sshTestConnection(testConfig);
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

        // Provide more detailed error messages based on auth type and error
        let errorMsg = result.error || 'Connection failed';
        let suggestKeyAuth = false;

        // Agent auth failures - be more aggressive with fallback
        if (formData.authType === 'agent') {
          // Any agent failure should suggest key auth
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

        // Auto-switch to key auth on agent failure for better UX
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
  }, [formData, connectionId]);

  // Browse remote directory
  const browseRemotePath = useCallback(
    async (path: string) => {
      if (!connectionId) return;

      setIsBrowsing(true);
      setBrowseError(null);

      try {
        const result = await window.electronAPI.sshListFiles(connectionId, path);
        // Handle both old array format and new object format for backward compatibility
        const entries: FileEntry[] =
          result && typeof result === 'object' && 'files' in result
            ? (result.files as FileEntry[]) || []
            : Array.isArray(result)
              ? (result as FileEntry[])
              : [];
        // Sort: directories first, then files, alphabetically
        const sorted = entries.sort((a: FileEntry, b: FileEntry) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setFileEntries(sorted);
        updateField('remotePath', path);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to browse directory';
        setBrowseError(message);
      } finally {
        setIsBrowsing(false);
      }
    },
    [connectionId, updateField]
  );

  // Select an existing saved connection
  const selectExistingConnection = useCallback(
    async (conn: (typeof savedConnections)[number]) => {
      setSelectedSavedConnection(conn.id);
      setUseExistingConnection(true);
      setErrors({});

      // Populate form data for display in confirm step
      setFormData((prev) => ({
        ...prev,
        name: conn.name,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        authType: conn.authType,
        privateKeyPath: conn.privateKeyPath || '',
      }));

      // Connect using the saved connection ID
      try {
        const connId = await window.electronAPI.sshConnect(conn.id);
        setConnectionId(connId);
        setCurrentStep('path');

        // Browse directly with connId since connectionId state hasn't updated yet
        const homePath = '/home/' + conn.username;
        setIsBrowsing(true);
        setBrowseError(null);
        try {
          const result = await window.electronAPI.sshListFiles(connId, homePath);
          const entries: FileEntry[] =
            result && typeof result === 'object' && 'files' in result
              ? (result.files as FileEntry[]) || []
              : Array.isArray(result)
                ? (result as FileEntry[])
                : [];
          const sorted = entries.sort((a: FileEntry, b: FileEntry) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          setFileEntries(sorted);
          updateField('remotePath', homePath);
        } catch (browseErr) {
          const msg = browseErr instanceof Error ? browseErr.message : 'Failed to browse directory';
          setBrowseError(msg);
        } finally {
          setIsBrowsing(false);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reconnect';
        setErrors({ general: message });
        setUseExistingConnection(false);
        setSelectedSavedConnection(null);
      }
    },
    [updateField]
  );

  // Navigate up
  const navigateUp = useCallback(() => {
    const currentPath = formData.remotePath;
    if (currentPath === '/') return;
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    void browseRemotePath(parentPath);
  }, [formData.remotePath, browseRemotePath]);

  // Navigate to directory
  const navigateTo = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory') {
        void browseRemotePath(entry.path);
      } else {
        // For files, select the parent directory
        const parentPath = entry.path.split('/').slice(0, -1).join('/') || '/';
        updateField('remotePath', parentPath);
      }
    },
    [browseRemotePath, updateField]
  );

  // Auto-extract directory name from clone URL (only if user hasn't manually edited it)
  useEffect(() => {
    if (cloneDirManuallyEdited) return;
    if (!cloneUrl.trim()) {
      setCloneDirName('');
      return;
    }
    const cleaned = cloneUrl.trim().replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '');
    // Try common URL patterns
    const match = cleaned.match(/[/:]([^/]+?)(?:\.git)?\/?$/);
    if (match) {
      setCloneDirName(match[1]);
    }
  }, [cloneUrl, cloneDirManuallyEdited]);

  // Handle next step
  const handleNext = useCallback(async () => {
    if (!validateStep(currentStep)) return;

    if (currentStep === 'auth') {
      // Test connection before proceeding
      const success = await testConnection();
      if (!success) return;

      // Create connection for browsing
      try {
        const connectConfig: SshConfig & { password?: string; passphrase?: string } = {
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

        const connId = await window.electronAPI.sshConnect({
          ...connectConfig,
          id: connectionId || undefined,
        });
        setConnectionId(connId);

        // Browse directly with connId since connectionId state hasn't updated yet
        const homePath = '/home/' + formData.username;
        setIsBrowsing(true);
        setBrowseError(null);
        try {
          const result = await window.electronAPI.sshListFiles(connId, homePath);
          const entries: FileEntry[] =
            result && typeof result === 'object' && 'files' in result
              ? (result.files as FileEntry[]) || []
              : Array.isArray(result)
                ? (result as FileEntry[])
                : [];
          const sorted = entries.sort((a: FileEntry, b: FileEntry) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          setFileEntries(sorted);
          updateField('remotePath', homePath);
        } catch (browseErr) {
          const msg = browseErr instanceof Error ? browseErr.message : 'Failed to browse directory';
          setBrowseError(msg);
        } finally {
          setIsBrowsing(false);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to connect';
        setTestStatus('idle');
        setTestResult(null);
        setErrors((prev) => ({ ...prev, general: message }));
        return;
      }
    }

    // Handle repo creation/cloning on the path step before advancing to confirm
    if (currentStep === 'path' && connectionId) {
      if (repoMode === 'create') {
        setIsCreatingRepo(true);
        setErrors({});
        try {
          const createdPath = await window.electronAPI.sshInitRepo(
            connectionId,
            formData.remotePath.replace(/\/+$/, ''),
            newRepoName.trim()
          );
          updateField('remotePath', createdPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create repository';
          setErrors({ general: msg });
          setIsCreatingRepo(false);
          return;
        }
        setIsCreatingRepo(false);
      } else if (repoMode === 'clone') {
        setIsCloningRepo(true);
        setErrors({});
        try {
          const targetPath = `${formData.remotePath.replace(/\/+$/, '')}/${cloneDirName.trim()}`;
          const clonedPath = await window.electronAPI.sshCloneRepo(
            connectionId,
            cloneUrl.trim(),
            targetPath
          );
          updateField('remotePath', clonedPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to clone repository';
          setErrors({ general: msg });
          setIsCloningRepo(false);
          return;
        }
        setIsCloningRepo(false);
      }
    }

    const stepOrder: WizardStep[] = useExistingConnection
      ? ['connection', 'path', 'confirm']
      : ['connection', 'auth', 'path', 'confirm'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    }
  }, [
    currentStep,
    formData,
    connectionId,
    validateStep,
    testConnection,
    updateField,
    useExistingConnection,
    repoMode,
    newRepoName,
    cloneUrl,
    cloneDirName,
  ]);

  // Handle previous step
  const handleBack = useCallback(() => {
    if (useExistingConnection && currentStep === 'path') {
      // Going back from path with existing connection → reset to connection selection
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

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!validateStep('path')) return;

    setIsSubmitting(true);

    try {
      // Derive project display name from the remote folder path, not the connection name
      const projectName = formData.remotePath.split('/').filter(Boolean).pop() || formData.name;

      if (useExistingConnection && selectedSavedConnection) {
        // Reuse existing connection — no save needed
        onSuccess({
          id: Date.now().toString(),
          name: projectName,
          path: formData.remotePath,
          host: formData.host,
          connectionId: selectedSavedConnection,
        });
      } else {
        // Save a new connection
        const saveConfig: SshConfig & { password?: string; passphrase?: string } = {
          id: connectionId || undefined,
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

        const savedConfig = await window.electronAPI.sshSaveConnection(saveConfig);

        onSuccess({
          id: Date.now().toString(),
          name: projectName,
          path: formData.remotePath,
          host: formData.host,
          connectionId: savedConfig.id!,
        });
      }

      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save connection';
      setErrors((prev) => ({ ...prev, general: message }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    formData,
    connectionId,
    validateStep,
    onSuccess,
    onClose,
    useExistingConnection,
    selectedSavedConnection,
  ]);

  // Handle close
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isSubmitting) {
        // Clean up connection if we're closing
        if (connectionId) {
          void window.electronAPI.sshDisconnect(connectionId);
        }
        onClose();
      }
    },
    [isSubmitting, connectionId, onClose]
  );

  // Step indicators — omit auth step when reusing an existing connection
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

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'connection':
        return (
          <div className="space-y-4">
            {/* Saved connections for reuse */}
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
                      onClick={() => void selectExistingConnection(conn)}
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

            {sshConfigHosts.length > 0 && (
              <div className="space-y-2">
                <Label>SSH Config (optional)</Label>
                <Select
                  value={sshConfigSelection}
                  onValueChange={(value) => {
                    setSshConfigSelection(value);
                    const selected = sshConfigHosts.find((h) => h.host === value);
                    if (selected) applySshHost(selected);
                  }}
                  disabled={isLoadingSshConfig}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingSshConfig
                          ? 'Loading ~/.ssh/config...'
                          : 'Select a host from ~/.ssh/config'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sshConfigHosts.map((h) => (
                      <SelectItem key={h.host} value={h.host}>
                        {h.host}
                        {h.hostname ? ` -> ${h.hostname}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecting a host auto-fills name, host, user, port, and key path when available.
                </p>
              </div>
            )}

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
            {/* Show common SSH key paths when key auth is selected */}
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
                  <RadioGroupItem value="password" id="auth-password" className="sr-only" />
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
                  <RadioGroupItem value="key" id="auth-key" className="sr-only" />
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
                  <RadioGroupItem value="agent" id="auth-agent" className="sr-only" />
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
                          const result = await window.electronAPI.openProject();
                          if (result.success && result.path) {
                            updateField('privateKeyPath', result.path);
                          }
                        } catch (e) {
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

            {/* Connection Test Result */}
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
            {/* Repo mode picker */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'pick' as RepoMode, label: 'Pick Existing', icon: FolderOpen },
                  { id: 'create' as RepoMode, label: 'Create New', icon: Plus },
                  { id: 'clone' as RepoMode, label: 'Clone', icon: Download },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setRepoMode(id);
                    setErrors({});
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md border-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    repoMode === id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-muted text-muted-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <Separator />

            {/* Mode-specific form fields */}
            {repoMode === 'create' && (
              <div className="space-y-2">
                <Label htmlFor="new-repo-name">
                  Repository Name <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <GitBranch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-repo-name"
                    value={newRepoName}
                    onChange={(e) => {
                      setNewRepoName(e.target.value);
                      setErrors((prev) => ({ ...prev, general: undefined }));
                    }}
                    placeholder="my-new-project"
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  A new git repository will be created at{' '}
                  <span className="font-mono">
                    {formData.remotePath.replace(/\/+$/, '')}/{newRepoName || '...'}
                  </span>
                </p>
              </div>
            )}

            {repoMode === 'clone' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="clone-url">
                    Repository URL <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="clone-url"
                      value={cloneUrl}
                      onChange={(e) => {
                        setCloneUrl(e.target.value);
                        setErrors((prev) => ({ ...prev, general: undefined }));
                      }}
                      placeholder="https://github.com/owner/repo.git"
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clone-dir">Directory Name</Label>
                  <Input
                    id="clone-dir"
                    value={cloneDirName}
                    onChange={(e) => {
                      setCloneDirName(e.target.value);
                      setCloneDirManuallyEdited(true);
                    }}
                    placeholder="repo"
                  />
                  <p className="text-xs text-muted-foreground">
                    Will be cloned to{' '}
                    <span className="font-mono">
                      {formData.remotePath.replace(/\/+$/, '')}/{cloneDirName || '...'}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* Path browser header */}
            <div className="space-y-2">
              <Label>{repoMode === 'pick' ? 'Project Path' : 'Parent Directory'}</Label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <FolderOpen className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="remote-path"
                    value={formData.remotePath}
                    onChange={(e) => updateField('remotePath', e.target.value)}
                    onBlur={() => touchField('remotePath')}
                    placeholder={repoMode === 'pick' ? '/home/user/myproject' : '/home/user'}
                    className={cn(
                      'pl-10',
                      errors.remotePath && touched.remotePath && 'border-destructive'
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void browseRemotePath(formData.remotePath || '/')}
                  disabled={isBrowsing}
                >
                  {isBrowsing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              {errors.remotePath && touched.remotePath && (
                <p className="text-xs text-destructive">{errors.remotePath}</p>
              )}
            </div>

            {browseError && (
              <Badge
                variant="outline"
                className="w-full justify-start gap-2 border-destructive/40 bg-destructive/10 py-1.5"
              >
                <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                <span className="whitespace-pre-wrap break-words">{browseError}</span>
              </Badge>
            )}

            {/* Directory browser */}
            <div className="overflow-hidden rounded-md border">
              <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6"
                  onClick={navigateUp}
                  disabled={formData.remotePath === '/' || isBrowsing}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {formData.remotePath || '/'}
                </span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {isBrowsing && fileEntries.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="md" />
                  </div>
                ) : fileEntries.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Click refresh to browse directory
                  </div>
                ) : (
                  <div className="divide-y">
                    {fileEntries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        onClick={() => navigateTo(entry)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                          entry.type === 'directory' && 'font-medium'
                        )}
                      >
                        {entry.type === 'directory' ? (
                          <Folder className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <FileCode className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.type === 'file' && (
                          <span className="text-xs text-muted-foreground">
                            {(entry.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {repoMode === 'pick' &&
                'Select the directory containing your project. Click on a folder to navigate into it.'}
              {repoMode === 'create' && 'Navigate to where you want to create the new repository.'}
              {repoMode === 'clone' && 'Navigate to where you want to clone the repository.'}
            </p>
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
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Remote Project</DialogTitle>
          <DialogDescription>
            Connect to a remote server via SSH to work on your project.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* Step indicator */}
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
                    className={cn(
                      'h-4 w-4',
                      isCompleted ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step title */}
        <div>
          <h3 className="text-lg font-medium">{steps[currentStepIndex]?.label}</h3>
        </div>

        {/* Error display (hidden on auth step where test result badge already shows it) */}
        {errors.general && currentStep !== 'auth' && (
          <Badge
            variant="outline"
            className="w-full justify-start gap-2 border-destructive/40 bg-destructive/10 py-1.5"
          >
            <XCircle className="h-3 w-3 shrink-0 text-destructive" />
            <span className="whitespace-pre-wrap break-words">{errors.general}</span>
          </Badge>
        )}

        {/* Step content */}
        <div className="min-w-0 py-2">{renderStepContent()}</div>

        {/* Navigation buttons */}
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
              disabled={
                isSubmitting ||
                (currentStep === 'auth' && testStatus === 'testing') ||
                isCreatingRepo ||
                isCloningRepo
              }
            >
              {currentStep === 'auth' && testStatus === 'testing' ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : isCreatingRepo ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : isCloningRepo ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Cloning...
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
    </Dialog>
  );
};

export default AddRemoteProjectModal;
