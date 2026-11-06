import { ValidationError } from '@avchetan/shared';
import { and, asc, eq } from 'drizzle-orm';
import { contextRules } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import {
  getById,
  insertSynced,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
} from '../synced';

/** A window context rule (docs/product/window-context.md#rules). */
export type ContextRule = Row<typeof contextRules>;

export type ContextRuleFields = {
  appPattern: string;
  titlePattern: string | null;
  projectId: string | null;
  tagPaths: string[];
  enabled: boolean;
};

function clean(fields: ContextRuleFields): ContextRuleFields {
  const appPattern = fields.appPattern.trim();
  if (!appPattern) throw new ValidationError('invalid_name', 'A rule needs an app');
  const titlePattern = fields.titlePattern?.trim() || null;
  return { ...fields, appPattern, titlePattern };
}

export function contextRulesRepo(deps: RepoDeps) {
  return {
    getById: (db: ClientDb, id: string) => getById(db, contextRules, id),

    /** Oldest first: the first matching rule with a project sets it. */
    list(db: ClientDb): Promise<ContextRule[]> {
      return db
        .select()
        .from(contextRules)
        .where(live(contextRules))
        .orderBy(asc(contextRules.createdAt), asc(contextRules.id));
    },

    listEnabled(db: ClientDb): Promise<ContextRule[]> {
      return db
        .select()
        .from(contextRules)
        .where(and(live(contextRules), eq(contextRules.enabled, true)))
        .orderBy(asc(contextRules.createdAt), asc(contextRules.id));
    },

    create: (tx: Tx, fields: ContextRuleFields) =>
      insertSynced(tx, deps, contextRules, clean(fields)),

    update: (tx: Tx, id: string, fields: ContextRuleFields) =>
      updateSynced(tx, deps, contextRules, id, clean(fields)),

    setEnabled: (tx: Tx, id: string, enabled: boolean) =>
      updateSynced(tx, deps, contextRules, id, { enabled }),

    remove: (tx: Tx, id: string) => softDeleteSynced(tx, deps, contextRules, [id]),
  };
}
