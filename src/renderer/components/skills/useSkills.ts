import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CatalogSkill, CatalogIndex } from '@shared/skills/types';

export function useSkills() {
  const [catalog, setCatalog] = useState<CatalogIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<CatalogSkill | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
    async (skillId: string) => {
      // Optimistic update
      setCatalog((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) => (s.id === skillId ? { ...s, installed: true } : s)),
        };
      });

      try {
        const result = await window.electronAPI.skillsInstall({ skillId });
        if (!result.success) {
          // Revert optimistic update
          setCatalog((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              skills: prev.skills.map((s) => (s.id === skillId ? { ...s, installed: false } : s)),
            };
          });
        } else {
          // Reload to get fresh state
          await loadCatalog();
        }
        return result.success;
      } catch {
        await loadCatalog();
        return false;
      }
    },
    [loadCatalog]
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

      try {
        const result = await window.electronAPI.skillsUninstall({ skillId });
        if (!result.success) {
          await loadCatalog();
        }
        return result.success;
      } catch {
        await loadCatalog();
        return false;
      }
    },
    [loadCatalog]
  );

  const openDetail = useCallback(async (skill: CatalogSkill) => {
    setSelectedSkill(skill);
    setShowDetailModal(true);
    // Load full detail
    try {
      const result = await window.electronAPI.skillsGetDetail({ skillId: skill.id });
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
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
    loadCatalog,
  };
}
