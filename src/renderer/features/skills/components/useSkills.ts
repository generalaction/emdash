import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const CATALOG_QUERY_KEY = ['skills', 'catalog'] as const;

function markSkillInstalled(catalog: CatalogIndex | null | undefined, skillId: string) {
  if (!catalog) return catalog;

  return {
    ...catalog,
    skills: catalog.skills.map((skill) =>
      skill.id === skillId ? { ...skill, installed: true } : skill
    ),
  };
}

export function useSkills() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // 350ms keeps the request rate sane while typing — short enough to feel reactive,
  // long enough that mid-word keystrokes don't each fire a request and risk rate-limiting.
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), 350);

  const { data: catalog = null, isPending: isLoading } = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.skills.getCatalog();
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to load catalog');
      }
      return result.data;
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const result = await rpc.skills.refreshCatalog();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to refresh catalog');
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CATALOG_QUERY_KEY, data);
    },
    onError: (error) => {
      log.error('Failed to refresh catalog:', error);
    },
  });

  const refresh = useCallback(() => refreshMutation.mutate(), [refreshMutation]);

  const { data: searchCatalog = null, isFetching: isSearching } = useQuery({
    queryKey: ['skills', 'search', debouncedSearchQuery],
    queryFn: async () => {
      const result = await rpc.skills.searchCatalog({ query: debouncedSearchQuery });
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to search catalog');
    },
    enabled: debouncedSearchQuery.length >= 2,
    placeholderData: keepPreviousData,
    // Cache results per query: re-typing the same word reuses the previous response
    // instead of hitting skills.sh again. gcTime keeps it warm across navigations.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const installMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const result = await rpc.skills.install({ skillId });
      if (!result.success) throw new Error(result.error ?? 'Could not install skill');
      return skillId;
    },
    onError: (error) => {
      toast({
        title: 'Install failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: (skillId) => {
      const skill =
        searchCatalog?.skills.find((s) => s.id === skillId) ??
        queryClient
          .getQueryData<CatalogIndex>(CATALOG_QUERY_KEY)
          ?.skills.find((s) => s.id === skillId);

      queryClient.setQueryData<CatalogIndex | null>(CATALOG_QUERY_KEY, (catalog) =>
        markSkillInstalled(catalog, skillId)
      );
      queryClient.setQueriesData<CatalogIndex | null>(
        { queryKey: ['skills', 'search'] },
        (catalog) => markSkillInstalled(catalog, skillId)
      );

      captureTelemetry('skill_installed', { source: skill?.source });
      toast({
        title: 'Skill installed',
        description: `${skillId} is now available across your agents`,
      });
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });

  const install = useCallback(
    async (skillId: string): Promise<boolean> => {
      try {
        await installMutation.mutateAsync(skillId);
        return true;
      } catch {
        return false;
      }
    },
    [installMutation]
  );

  const uninstallMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const result = await rpc.skills.uninstall({ skillId });
      if (!result.success) throw new Error(result.error ?? 'Could not uninstall skill');
      return skillId;
    },
    onError: (error) => {
      toast({
        title: 'Uninstall failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      captureTelemetry('skill_uninstalled');

      toast({ title: 'Skill removed', description: 'Skill has been uninstalled' });
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });

  const uninstall = useCallback(
    async (skillId: string): Promise<boolean> => {
      try {
        await uninstallMutation.mutateAsync(skillId);
        return true;
      } catch {
        return false;
      }
    },
    [uninstallMutation]
  );

  const { data: detailData, isFetching: isDetailLoading } = useQuery({
    queryKey: ['skills', 'detail', selectedSkillId],
    queryFn: async () => {
      const result = await rpc.skills.getDetail({ skillId: selectedSkillId! });
      if (result.success && result.data) return result.data;
      throw new Error('Failed to load skill detail');
    },
    enabled: !!selectedSkillId && showDetailModal,
  });

  const selectedSkill = useMemo<CatalogSkill | null>(() => {
    if (!selectedSkillId || !showDetailModal) return null;
    return (
      detailData ??
      searchCatalog?.skills.find((s) => s.id === selectedSkillId) ??
      catalog?.skills.find((s) => s.id === selectedSkillId) ??
      null
    );
  }, [selectedSkillId, showDetailModal, detailData, searchCatalog, catalog]);

  const openDetail = useCallback((skill: CatalogSkill) => {
    setSelectedSkillId(skill.id);
    setShowDetailModal(true);
  }, []);

  const closeDetail = useCallback(() => {
    setShowDetailModal(false);
    setSelectedSkillId(null);
  }, []);

  const trimmedQuery = searchQuery.trim();

  const filteredSkills = useMemo(() => {
    if (!catalog) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return catalog.skills;

    const localFilter = catalog.skills.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );

    // When the remote search has returned hits, prefer those (they cover the
    // full skills.sh index, not just the cached top-N catalog). Fall back to
    // the local filter while the request is in flight or if it returned empty.
    const remoteHits = trimmedQuery === debouncedSearchQuery ? (searchCatalog?.skills ?? []) : [];
    if (remoteHits.length === 0) return localFilter;

    // Merge: local installed/matched first (preserves installed state), then
    // remote hits not already in the local list.
    const seen = new Set<string>();
    const merged: CatalogSkill[] = [];
    for (const s of localFilter) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    for (const s of remoteHits) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    return merged;
  }, [catalog, searchQuery, trimmedQuery, debouncedSearchQuery, searchCatalog]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((s) => s.installed),
    [filteredSkills]
  );

  const recommendedSkills = useMemo(
    () => filteredSkills.filter((s) => !s.installed),
    [filteredSkills]
  );

  const hasActiveSearch = debouncedSearchQuery.length >= 2 && trimmedQuery === debouncedSearchQuery;
  const isSearchingRemote =
    isSearching || (trimmedQuery.length >= 2 && trimmedQuery !== debouncedSearchQuery);

  return {
    catalog,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    isSearching: isSearchingRemote,
    hasActiveSearch,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    isDetailLoading,
    showDetailModal,
    filteredSkills,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  };
}
