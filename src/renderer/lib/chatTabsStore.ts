/**
 * Store for managing multiple chat tabs within a task/worktree
 * Following the exact pattern of taskTerminalsStore for consistency
 */

import { useSyncExternalStore, useMemo, useCallback } from 'react';
import { Provider } from '../types';

export interface ChatTab {
  id: string;                    // Unique tab identifier
  taskId: string;                 // Parent task ID
  providerId: Provider;           // Agent provider
  providerName: string;           // Display name
  conversationId: string;         // Database conversation ID
  terminalId: string;            // Unique terminal session
  title: string;                  // Tab display title
  createdAt: number;             // Creation timestamp
  isDirty?: boolean;             // Unsaved changes indicator
}

export interface ChatTabsState {
  tabs: ChatTab[];
  activeTabId: string | null;
  counter: number;  // For generating unique IDs
}

interface ChatTabsSnapshot extends ChatTabsState {
  version: number;
}

// Storage
const STORAGE_PREFIX = 'emdash:chatTabs:v1';
const STORAGE_VERSION = 1;

// State management
const chatTabStates = new Map<string, ChatTabsState>();
const chatTabListeners = new Map<string, Set<() => void>>();
const chatTabSnapshots = new Map<string, ChatTabsSnapshot>();

// Helper functions
function storageKey(taskId: string): string {
  return `${STORAGE_PREFIX}:${taskId}`;
}

function createDefaultState(taskId: string): ChatTabsState {
  return {
    tabs: [],
    activeTabId: null,
    counter: 0,
  };
}

function cloneState(state: ChatTabsState): ChatTabsState {
  return {
    tabs: state.tabs.map(tab => ({ ...tab })),
    activeTabId: state.activeTabId,
    counter: state.counter,
  };
}

function ensureTaskState(taskId: string): ChatTabsState {
  if (!chatTabStates.has(taskId)) {
    const loaded = loadFromStorage(taskId);
    if (loaded) {
      chatTabStates.set(taskId, loaded);
    } else {
      chatTabStates.set(taskId, createDefaultState(taskId));
    }
  }
  return chatTabStates.get(taskId)!;
}

function loadFromStorage(taskId: string): ChatTabsState | null {
  try {
    const key = storageKey(taskId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const snapshot: ChatTabsSnapshot = JSON.parse(stored);
    if (snapshot.version !== STORAGE_VERSION) return null;

    return {
      tabs: snapshot.tabs || [],
      activeTabId: snapshot.activeTabId,
      counter: snapshot.counter || 0,
    };
  } catch (error) {
    console.error('Failed to load chat tabs from storage:', error);
    return null;
  }
}

function saveToStorage(taskId: string, state: ChatTabsState) {
  try {
    const key = storageKey(taskId);
    const snapshot: ChatTabsSnapshot = {
      ...state,
      version: STORAGE_VERSION,
    };
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (error) {
    console.error('Failed to save chat tabs to storage:', error);
  }
}

function emit(taskId: string) {
  const listeners = chatTabListeners.get(taskId);
  if (listeners) {
    listeners.forEach(listener => listener());
  }
}

function ensureSnapshot(taskId: string, state: ChatTabsState) {
  chatTabSnapshots.set(taskId, {
    ...state,
    version: STORAGE_VERSION,
  });
}

// State mutations
function updateChatTabState(
  taskId: string,
  mutate: (draft: ChatTabsState) => void
) {
  const current = ensureTaskState(taskId);
  const draft = cloneState(current);

  mutate(draft);

  // Validation
  if (draft.tabs.length === 0) {
    draft.activeTabId = null;
  } else if (draft.activeTabId && !draft.tabs.some(t => t.id === draft.activeTabId)) {
    // Active tab was removed, activate the first one
    draft.activeTabId = draft.tabs[0].id;
  }

  chatTabStates.set(taskId, draft);
  ensureSnapshot(taskId, draft);
  saveToStorage(taskId, draft);
  emit(taskId);
}

// Public API
export function createChatTab(
  taskId: string,
  providerId: Provider,
  providerName: string,
  title?: string
): ChatTab {
  const state = ensureTaskState(taskId);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);

  const newTab: ChatTab = {
    id: `chat-${timestamp}-${random}`,
    taskId,
    providerId,
    providerName,
    conversationId: `conv-${timestamp}-${random}`,
    terminalId: `${providerId}-chat-${timestamp}-${taskId}`,
    title: title || `${providerName} Chat ${state.counter + 1}`,
    createdAt: timestamp,
    isDirty: false,
  };

  updateChatTabState(taskId, draft => {
    draft.tabs.push(newTab);
    draft.activeTabId = newTab.id;
    draft.counter += 1;
  });

  return newTab;
}

export function setActiveTab(taskId: string, tabId: string) {
  updateChatTabState(taskId, draft => {
    if (draft.tabs.some(t => t.id === tabId)) {
      draft.activeTabId = tabId;
    }
  });
}

export function closeTab(taskId: string, tabId: string) {
  const state = ensureTaskState(taskId);
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  updateChatTabState(taskId, draft => {
    const index = draft.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    draft.tabs.splice(index, 1);

    // Update active tab if needed
    if (draft.activeTabId === tabId && draft.tabs.length > 0) {
      // Activate the next tab, or previous if this was the last
      const newIndex = Math.min(index, draft.tabs.length - 1);
      draft.activeTabId = draft.tabs[newIndex].id;
    }
  });

  return tab;
}

export function updateTabTitle(taskId: string, tabId: string, title: string) {
  updateChatTabState(taskId, draft => {
    const tab = draft.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = title;
    }
  });
}

export function markTabDirty(taskId: string, tabId: string, isDirty: boolean) {
  updateChatTabState(taskId, draft => {
    const tab = draft.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.isDirty = isDirty;
    }
  });
}

export function clearTaskTabs(taskId: string) {
  chatTabStates.delete(taskId);
  chatTabSnapshots.delete(taskId);
  try {
    localStorage.removeItem(storageKey(taskId));
  } catch {}
  emit(taskId);
}

// Subscribe/unsubscribe
function subscribe(taskId: string, listener: () => void): () => void {
  if (!chatTabListeners.has(taskId)) {
    chatTabListeners.set(taskId, new Set());
  }

  const listeners = chatTabListeners.get(taskId)!;
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      chatTabListeners.delete(taskId);
    }
  };
}

function getSnapshot(taskId: string): ChatTabsSnapshot {
  const state = ensureTaskState(taskId);

  if (!chatTabSnapshots.has(taskId)) {
    ensureSnapshot(taskId, state);
  }

  return chatTabSnapshots.get(taskId)!;
}

// React Hook
export function useChatTabs(taskId: string | null) {
  const resolvedId = taskId || 'global';

  const snapshot = useSyncExternalStore(
    useCallback((listener) => subscribe(resolvedId, listener), [resolvedId]),
    useCallback(() => getSnapshot(resolvedId), [resolvedId]),
    useCallback(() => getSnapshot(resolvedId), [resolvedId])
  );

  const actions = useMemo(() => ({
    createTab: (providerId: Provider, providerName: string, title?: string) =>
      createChatTab(resolvedId, providerId, providerName, title),
    setActiveTab: (tabId: string) => setActiveTab(resolvedId, tabId),
    closeTab: (tabId: string) => closeTab(resolvedId, tabId),
    updateTabTitle: (tabId: string, title: string) =>
      updateTabTitle(resolvedId, tabId, title),
    markTabDirty: (tabId: string, isDirty: boolean) =>
      markTabDirty(resolvedId, tabId, isDirty),
    clearTabs: () => clearTaskTabs(resolvedId),
  }), [resolvedId]);

  const activeTab = snapshot.tabs.find(
    tab => tab.id === snapshot.activeTabId
  ) ?? null;

  return {
    tabs: snapshot.tabs,
    activeTabId: snapshot.activeTabId,
    activeTab,
    ...actions,
  };
}