import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const CATALOG_QUERY_KEY = ['skills', 'catalog'] as const;

export function useSkills() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillSource, setSelectedSkillSource] = useState<
    { owner: string; repo: string } | undefined
  >(undefined);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // skills.sh search state
  const [searchResults, setSearchResults] = useState<CatalogSkill[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef(0);

  const { data: catalog = null, isPending: isLoading } = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.skills.getCatalog();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load catalog');
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

  // Debounced skills.sh search — fires when query is >= 2 chars
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      ++searchAbortRef.current;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const id = ++searchAbortRef.current;

    const timer = setTimeout(async () => {
      try {
        const result = await rpc.skills.search({ query: trimmed });
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

  const installMutation = useMutation({
    mutationFn: async (payload: { skillId: string; source?: { owner: string; repo: string } }) => {
      const result = await rpc.skills.install({
        skillId: payload.skillId,
        source: payload.source,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not install skill');
      return payload.skillId;
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
        queryClient
          .getQueryData<CatalogIndex>(CATALOG_QUERY_KEY)
          ?.skills.find((s) => s.id === skillId) ?? searchResults.find((s) => s.id === skillId);

      captureTelemetry('skill_installed', { source: skill?.source ?? 'skills-sh' });
      toast({
        title: 'Skill installed',
        description: `${skillId} is now available across your agents`,
      });
      setSearchResults((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s))
      );
      queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });

  const install = useCallback(
    async (skillId: string, source?: { owner: string; repo: string }): Promise<boolean> => {
      try {
        await installMutation.mutateAsync({ skillId, source });
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
    onSuccess: (skillId) => {
      captureTelemetry('skill_uninstalled');
      toast({ title: 'Skill removed', description: 'Skill has been uninstalled' });
      setSearchResults((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: false, localPath: undefined } : s))
      );
      queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
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

  const { data: detailData } = useQuery({
    queryKey: [
      'skills',
      'detail',
      selectedSkillId,
      selectedSkillSource?.owner,
      selectedSkillSource?.repo,
    ],
    queryFn: async () => {
      const result = await rpc.skills.getDetail({
        skillId: selectedSkillId!,
        source: selectedSkillSource,
      });
      if (result.success && result.data) return result.data;
      throw new Error('Failed to load skill detail');
    },
    enabled: !!selectedSkillId && showDetailModal,
  });

  const selectedSkill = useMemo<CatalogSkill | null>(() => {
    if (!selectedSkillId || !showDetailModal) return null;
    if (detailData) return detailData;
    const fromCatalog = catalog?.skills.find((s) => s.id === selectedSkillId);
    if (fromCatalog) return fromCatalog;
    return searchResults.find((s) => s.id === selectedSkillId) ?? null;
  }, [selectedSkillId, showDetailModal, detailData, catalog, searchResults]);

  const openDetail = useCallback((skill: CatalogSkill) => {
    captureTelemetry('skill_detail_viewed', { source: skill.source });
    setSelectedSkillId(skill.id);
    setSelectedSkillSource(
      skill.source === 'skills-sh' && skill.owner && skill.repo
        ? { owner: skill.owner, repo: skill.repo }
        : undefined
    );
    setShowDetailModal(true);
  }, []);

  const closeDetail = useCallback(() => {
    setShowDetailModal(false);
    setSelectedSkillId(null);
    setSelectedSkillSource(undefined);
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

  const catalogIds = useMemo(() => new Set(filteredSkills.map((s) => s.id)), [filteredSkills]);
  const skillsShResults = useMemo(
    () => searchResults.filter((s) => !catalogIds.has(s.id)),
    [searchResults, catalogIds]
  );

  const isSearchActive = searchQuery.trim().length >= 2;

  return {
    catalog,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    showDetailModal,
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
  };
}
