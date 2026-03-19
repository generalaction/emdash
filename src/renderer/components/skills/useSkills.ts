import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { CatalogSkill, CatalogIndex } from '@shared/skills/types';
import { useToast } from '@/hooks/use-toast';

export function useSkills() {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<CatalogIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<CatalogSkill | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // skills.sh search state
  const [searchResults, setSearchResults] = useState<CatalogSkill[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef(0);

  const loadCatalog = useCallback(async () => {
    try {
      const result = await window.electronAPI.skillsGetCatalog();
      if (result.success && result.data) {
        setCatalog(result.data);
      }
    } catch (error) {
      console.error('Failed to load skills catalog:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Debounced skills.sh search — fires when query is >= 2 chars
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      ++searchAbortRef.current; // invalidate any in-flight request
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const id = ++searchAbortRef.current;

    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.skillsSearch({ query: trimmed });
        // Only apply if this is still the latest search
        if (id !== searchAbortRef.current) return;
        if (result.success && result.data) {
          setSearchResults(result.data);
        } else {
          setSearchResults([]);
        }
      } catch {
        if (id === searchAbortRef.current) setSearchResults([]);
      } finally {
        if (id === searchAbortRef.current) setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await window.electronAPI.skillsRefreshCatalog();
      if (result.success && result.data) {
        setCatalog(result.data);
      }
    } catch (error) {
      console.error('Failed to refresh catalog:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const install = useCallback(
    async (skillId: string, source?: { owner: string; repo: string }) => {
      // Optimistic update for catalog skills
      setCatalog((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) => (s.id === skillId ? { ...s, installed: true } : s)),
        };
      });
      // Also update search results optimistically
      setSearchResults((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s))
      );

      try {
        const result = await window.electronAPI.skillsInstall({ skillId, source });
        if (!result.success) {
          // Revert optimistic updates
          setCatalog((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              skills: prev.skills.map((s) => (s.id === skillId ? { ...s, installed: false } : s)),
            };
          });
          setSearchResults((prev) =>
            prev.map((s) => (s.id === skillId ? { ...s, installed: false } : s))
          );
          toast({
            title: 'Install failed',
            description: result.error || 'Could not install skill',
            variant: 'destructive',
          });
        } else {
          const skill = catalog?.skills.find((s) => s.id === skillId);
          import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
            captureTelemetry('skill_installed', { source: skill?.source || 'skills-sh' });
          });
          toast({
            title: 'Skill installed',
            description: `${skillId} is now available across your agents`,
          });
          await loadCatalog();
        }
        return result.success;
      } catch {
        toast({
          title: 'Install failed',
          description: 'An unexpected error occurred',
          variant: 'destructive',
        });
        await loadCatalog();
        return false;
      }
    },
    [catalog?.skills, loadCatalog, toast]
  );

  const uninstall = useCallback(
    async (skillId: string) => {
      // Optimistic update
      setCatalog((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) =>
            s.id === skillId ? { ...s, installed: false, localPath: undefined } : s
          ),
        };
      });
      setSearchResults((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: false, localPath: undefined } : s))
      );

      try {
        const result = await window.electronAPI.skillsUninstall({ skillId });
        if (!result.success) {
          toast({
            title: 'Uninstall failed',
            description: result.error || 'Could not uninstall skill',
            variant: 'destructive',
          });
          await loadCatalog();
        } else {
          import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
            captureTelemetry('skill_uninstalled');
          });
          toast({ title: 'Skill removed', description: `${skillId} has been uninstalled` });
        }
        return result.success;
      } catch {
        toast({
          title: 'Uninstall failed',
          description: 'An unexpected error occurred',
          variant: 'destructive',
        });
        await loadCatalog();
        return false;
      }
    },
    [loadCatalog, toast]
  );

  const openDetail = useCallback(async (skill: CatalogSkill) => {
    import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('skill_detail_viewed', { source: skill.source });
    });
    setSelectedSkill(skill);
    setShowDetailModal(true);
    // Load full detail — pass source for skills-sh skills not in catalog
    try {
      const source =
        skill.source === 'skills-sh' && skill.owner && skill.repo
          ? { owner: skill.owner, repo: skill.repo }
          : undefined;
      const result = await window.electronAPI.skillsGetDetail({ skillId: skill.id, source });
      if (result.success && result.data) {
        setSelectedSkill(result.data);
      }
    } catch {
      // Keep what we have
    }
  }, []);

  const closeDetail = useCallback(() => {
    setShowDetailModal(false);
    setSelectedSkill(null);
  }, []);

  // Filter the local catalog by query (instant, client-side)
  const filteredSkills = useMemo(() => {
    if (!catalog) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return catalog.skills;
    return catalog.skills.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );
  }, [catalog, searchQuery]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((s) => s.installed),
    [filteredSkills]
  );

  const recommendedSkills = useMemo(
    () => filteredSkills.filter((s) => !s.installed),
    [filteredSkills]
  );

  // skills.sh results, excluding those already shown in the catalog
  const catalogIds = useMemo(() => new Set(filteredSkills.map((s) => s.id)), [filteredSkills]);
  const skillsShResults = useMemo(
    () => searchResults.filter((s) => !catalogIds.has(s.id)),
    [searchResults, catalogIds]
  );

  const isSearchActive = searchQuery.trim().length >= 2;

  return {
    catalog,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    showDetailModal,
    showCreateModal,
    setShowCreateModal,
    filteredSkills,
    installedSkills,
    recommendedSkills,
    skillsShResults,
    isSearching,
    isSearchActive,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
    loadCatalog,
  };
}
