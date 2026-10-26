import { derivedId, slugify, ValidationError } from '@avchetan/shared';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { projects } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import {
  getById,
  insertSynced,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';

export type Project = Row<typeof projects>;

export function projectsRepo(deps: RepoDeps) {
  const findBySlug = (db: ClientDb, slug: string): Promise<Project | undefined> =>
    db
      .select()
      .from(projects)
      .where(and(live(projects), eq(projects.slug, slug)))
      .orderBy(asc(projects.createdAt))
      .get();

  return {
    findBySlug,

    getById: (db: ClientDb, id: string) => getById(db, projects, id),

    listActive(db: ClientDb): Promise<Project[]> {
      return db
        .select()
        .from(projects)
        .where(and(live(projects), isNull(projects.archivedAt)))
        .orderBy(asc(projects.name));
    },

    /** Returns the existing project with the same slug, or creates one (ID derived from slug). */
    async create(
      tx: Tx,
      input: { name: string; description?: string | null; color?: string | null },
    ): Promise<Project> {
      const name = input.name.trim();
      const slug = slugify(name);
      if (!slug) throw new ValidationError('invalid_name', 'Project name is empty');

      const existing = await findBySlug(tx, slug);
      if (existing) return existing;

      const values = {
        name,
        slug,
        description: input.description ?? null,
        color: input.color ?? null,
        archivedAt: null,
      };
      const id = derivedId('project', slug);
      const holder = await getById(tx, projects, id);
      if (!holder || holder.deletedAt) return upsertSynced(tx, deps, projects, { id, ...values });
      return insertSynced(tx, deps, projects, values);
    },

    async rename(tx: Tx, id: string, newName: string): Promise<Project> {
      const name = newName.trim();
      const slug = slugify(name);
      if (!slug) throw new ValidationError('invalid_name', 'Project name is empty');
      const clash = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(live(projects), eq(projects.slug, slug), ne(projects.id, id)))
        .get();
      if (clash) {
        throw new ValidationError('duplicate_name', 'A project with this name already exists');
      }
      return updateSynced(tx, deps, projects, id, { name, slug });
    },

    archive: (tx: Tx, id: string) =>
      updateSynced(tx, deps, projects, id, { archivedAt: deps.clock.now() }),

    async softDelete(tx: Tx, id: string): Promise<void> {
      await softDeleteSynced(tx, deps, projects, [id]);
    },
  };
}
