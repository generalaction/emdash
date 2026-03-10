import { useCallback, useEffect, useState } from 'react';
import type { BrandGuideline } from '@/types/electron-api';

export function useBrand(workspaceId: string | undefined) {
  const [brands, setBrands] = useState<BrandGuideline[]>([]);
  const [activeBrand, setActiveBrand] = useState<BrandGuideline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBrands = useCallback(async () => {
    if (!workspaceId) {
      setBrands([]);
      setActiveBrand(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [brandsResult, activeResult] = await Promise.all([
        window.electronAPI.contentBrandGetByWorkspace(workspaceId),
        window.electronAPI.contentBrandGetActive(workspaceId),
      ]);

      if (brandsResult.success && brandsResult.data) {
        setBrands(brandsResult.data);
      }

      if (activeResult.success) {
        setActiveBrand(activeResult.data || null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadBrands();
  }, [workspaceId]);

  const createBrand = useCallback(
    async (name: string, content: string, isActive: boolean = true) => {
      if (!workspaceId) return null;

      try {
        const result = await window.electronAPI.contentBrandCreate({
          workspaceId,
          name,
          content,
          isActive,
        });

        if (result.success && result.data) {
          setBrands((prev) => [...prev, result.data!]);
          if (result.data.isActive) {
            setActiveBrand(result.data);
            // Update other brands to not be active
            setBrands((prev) =>
              prev.map((b) => (b.id === result.data!.id ? b : { ...b, isActive: false }))
            );
          }
          return result.data;
        } else {
          setError(result.error || 'Failed to create brand');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [workspaceId]
  );

  const updateBrand = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        content: string;
        isActive: boolean;
      }>
    ) => {
      try {
        const result = await window.electronAPI.contentBrandUpdate({
          id,
          ...updates,
        });

        if (result.success && result.data) {
          setBrands((prev) => prev.map((b) => (b.id === id ? result.data! : b)));
          if (result.data.isActive) {
            setActiveBrand(result.data);
            // Update other brands to not be active
            setBrands((prev) =>
              prev.map((b) => (b.id === result.data!.id ? b : { ...b, isActive: false }))
            );
          } else if (activeBrand?.id === id) {
            setActiveBrand(null);
          }
          return result.data;
        } else {
          setError(result.error || 'Failed to update brand');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [activeBrand]
  );

  const deleteBrand = useCallback(
    async (id: string) => {
      try {
        const result = await window.electronAPI.contentBrandDelete(id);
        if (result.success) {
          setBrands((prev) => prev.filter((b) => b.id !== id));
          if (activeBrand?.id === id) {
            setActiveBrand(null);
          }
          return true;
        } else {
          setError(result.error || 'Failed to delete brand');
          return false;
        }
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [activeBrand]
  );

  const setActiveById = useCallback(
    async (id: string) => {
      return updateBrand(id, { isActive: true });
    },
    [updateBrand]
  );

  return {
    brands,
    activeBrand,
    isLoading,
    error,
    createBrand,
    updateBrand,
    deleteBrand,
    setActiveById,
    refresh: loadBrands,
  };
}
