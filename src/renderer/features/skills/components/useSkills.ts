import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
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
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const {
    data: catalog = null,
    isPending: isLoading,
    refetch: loadCatalog,
  } = useQuery({
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
      const skill = queryClient
        .getQueryData<CatalogIndex>(CATALOG_QUERY_KEY)
        ?.skills.find((s) => s.id === skillId);

      captureTelemetry('skill_installed', { source: skill?.source });
      toast({
        title: 'Skill installed',
        description: `${skillId} is now available across your agents`,
      });
      queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
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
    return detailData ?? catalog?.skills.find((s) => s.id === selectedSkillId) ?? null;
  }, [selectedSkillId, showDetailModal, detailData, catalog]);

  const openDetail = useCallback((skill: CatalogSkill) => {
    setSelectedSkillId(skill.id);
    setShowDetailModal(true);
  }, []);

  const closeDetail = useCallback(() => {
    setShowDetailModal(false);
    setSelectedSkillId(null);
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
    isRefreshing: refreshMutation.isPending,
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
