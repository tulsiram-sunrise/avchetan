import { loadExtractionMode, loadExtractionSettings, runWrite } from '@avchetan/core';
import type { RawLogPrivacy } from '@avchetan/db';
import { useQuery } from '@tanstack/react-query';
import { writeContext } from '../services/writes';
import { useServices } from '../services-context';
import { useAction, useWrite } from './entries';

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
  useWrite((store, args: { id: string; privacy: RawLogPrivacy }) =>
    runWrite(writeContext(store), 'log.setPrivacy', args),
  );

/** Add by typing, normalized like a typed #tag; creates the tag if needed. */
export const useAddPrivateTag = () =>
  useWrite((store, path: string) => runWrite(writeContext(store), 'tag.addPrivate', { path }));

export const useSetTagPrivate = () => useAction('tag.setPrivate');
