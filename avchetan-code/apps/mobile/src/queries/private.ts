import { loadExtractionMode, loadExtractionSettings, normalizeTagPath } from '@avchetan/core';
import type { RawLogPrivacy } from '@avchetan/db';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useWrite } from './entries';

/** Private entries (docs/product/private-entries.md). */

/** Who organizes this phone's entries, and with which models: for the waiting badge. */
export function useOrganizingSetup() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'organizing-setup'],
    queryFn: async () => ({
      models: (await loadExtractionSettings(store)).models,
      delegated: (await loadExtractionMode(store)) === 'delegate',
    }),
  });
}

export function usePrivateTags() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tags', 'all'],
    queryFn: () => store.repos.tags.listAll(store.db),
  });
}

export const useSetPrivacy = () =>
  useWrite((store, { id, privacy }: { id: string; privacy: RawLogPrivacy }) =>
    store.write((tx) => store.repos.rawLogs.setPrivacy(tx, id, privacy)),
  );

/** Add by typing, normalized like a typed #tag; creates the tag if needed. */
export const useAddPrivateTag = () =>
  useWrite((store, path: string) =>
    store.write(async (tx) => {
      const tag = await store.repos.tags.ensurePath(tx, normalizeTagPath(path));
      return store.repos.tags.setMakesPrivate(tx, tag.id, true);
    }),
  );

export const useSetTagPrivate = () =>
  useWrite((store, { id, makesPrivate }: { id: string; makesPrivate: boolean }) =>
    store.write((tx) => store.repos.tags.setMakesPrivate(tx, id, makesPrivate)),
  );
