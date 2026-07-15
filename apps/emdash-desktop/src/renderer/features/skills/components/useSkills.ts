import {
  mergeSkillsInstalledState,
  type CatalogIndex,
  type CatalogSkill,
} from '@emdash/core/primitives/skills/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useInstalledSkillsLiveModel } from '@renderer/lib/agent-config/live-model-hooks';
import { getAgentConfigRuntimeClient } from '@renderer/lib/agent-config/runtime-client';
import { getCatalogRuntimeClient } from '@renderer/lib/catalog/runtime-client';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const CATALOG_QUERY_KEY = ['skills', 'catalog'] as const;

export function useSkills() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const { data: installedLiveSkills, isLoading: isLoadingInstalled } =
    useInstalledSkillsLiveModel();

  const { data: rawCatalog = null, isPending: isLoadingCatalog } = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      const client = await getCatalogRuntimeClient();
      const result = await client.getSkillsCatalog(undefined);
      if (result.success) return result.data;
      throw new Error(result.error.message);
    },
  });

  const catalog = useMemo(
    () => (rawCatalog ? mergeSkillsInstalledState(rawCatalog, installedLiveSkills) : null),
    [rawCatalog, installedLiveSkills]
  );
  const isLoading = isLoadingCatalog || isLoadingInstalled;

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const client = await getCatalogRuntimeClient();
      const result = await client.refreshSkillsCatalog(undefined);
      if (result.success) return result.data;
      throw new Error(result.error.message);
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
      const catalogClient = await getCatalogRuntimeClient();
      const payload = await catalogClient.resolveSkillInstall({ skillId });
      if (!payload.success) throw new Error(payload.error.message);
      const agentConfigClient = await getAgentConfigRuntimeClient();
      const result = await agentConfigClient.installSkill({ skill: payload.data });
      if (!result.success) throw new Error(result.error.message);
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
      void queryClient.invalidateQueries({ queryKey: ['skills', 'skillssh-search'] });
      queryClient.removeQueries({ queryKey: ['skills', 'detail'] });
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
      const skill =
        catalog?.skills.find((candidate) => candidate.id === skillId) ??
        installedLiveSkills.find(
          (candidate) => candidate.id === skillId || candidate.installId === skillId
        );
      const name = skill?.installId ?? skillId;
      const agentConfigClient = await getAgentConfigRuntimeClient();
      const result = await agentConfigClient.removeSkill({ name });
      if (!result.success) throw new Error(result.error.message);
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
      void queryClient.invalidateQueries({ queryKey: ['skills', 'skillssh-search'] });
      queryClient.removeQueries({ queryKey: ['skills', 'detail'] });
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

  const { data: detailData, isFetching: isLoadingDetail } = useQuery({
    queryKey: ['skills', 'detail', selectedSkillId],
    queryFn: async () => {
      const client = await getCatalogRuntimeClient();
      const result = await client.getSkillContent({ skillId: selectedSkillId! });
      if (result.success) return result.data;
      throw new Error(result.error.message);
    },
    enabled: !!selectedSkillId && showDetailModal,
  });

  const skillShQuery = useDebounce(searchQuery.trim(), 300);
  const { data: skillShSkills = [], isFetching: isSearchingSkillSh } = useQuery({
    queryKey: ['skills', 'skillssh-search', skillShQuery],
    queryFn: async () => {
      const client = await getCatalogRuntimeClient();
      const result = await client.searchSkillSh({ query: skillShQuery });
      if (result.success) return result.data;
      throw new Error(result.error.message);
    },
    enabled: skillShQuery.length >= 2,
    staleTime: 60_000,
  });

  const mergedSkillShSkills = useMemo(() => {
    const index: CatalogIndex = {
      version: rawCatalog?.version ?? 0,
      lastUpdated: rawCatalog?.lastUpdated ?? new Date(0).toISOString(),
      skills: skillShSkills,
    };
    return mergeSkillsInstalledState(index, installedLiveSkills).skills;
  }, [rawCatalog, skillShSkills, installedLiveSkills]);

  const selectedSkill = useMemo<CatalogSkill | null>(() => {
    if (!selectedSkillId || !showDetailModal) return null;
    const selected =
      detailData ??
      catalog?.skills.find((s) => s.id === selectedSkillId) ??
      mergedSkillShSkills.find((s) => s.id === selectedSkillId) ??
      null;
    if (!selected) return null;
    return mergeSkillsInstalledState(
      {
        version: rawCatalog?.version ?? 0,
        lastUpdated: rawCatalog?.lastUpdated ?? new Date(0).toISOString(),
        skills: [selected],
      },
      installedLiveSkills
    ).skills[0];
  }, [
    selectedSkillId,
    showDetailModal,
    detailData,
    catalog,
    mergedSkillShSkills,
    rawCatalog,
    installedLiveSkills,
  ]);

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

  const skillShSearchSkills = useMemo(() => {
    const installedKeys = new Set<string>();
    for (const skill of catalog?.skills ?? []) {
      if (!skill.installed) continue;
      installedKeys.add(skill.id);
      if (skill.installId) installedKeys.add(skill.installId);
    }

    return mergedSkillShSkills.filter(
      (skill) =>
        !skill.installed &&
        !installedKeys.has(skill.id) &&
        (!skill.installId || !installedKeys.has(skill.installId))
    );
  }, [catalog, mergedSkillShSkills]);

  return {
    catalog,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    isLoadingDetail,
    showDetailModal,
    filteredSkills,
    installedSkills,
    recommendedSkills,
    skillShSearchSkills,
    isSearchingSkillSh,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  };
}
