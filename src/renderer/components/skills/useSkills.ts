import { useState, useEffect, useCallback, useMemo } from 'react';
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
          toast({
            title: 'Install failed',
            description: result.error || 'Could not install skill',
            variant: 'destructive',
          });
        } else {
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
    [loadCatalog, toast]
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
          toast({
            title: 'Uninstall failed',
            description: result.error || 'Could not uninstall skill',
            variant: 'destructive',
          });
          await loadCatalog();
        } else {
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
