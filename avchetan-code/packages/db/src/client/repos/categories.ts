import { derivedId, slugify, ValidationError } from '@avchetan/shared';
import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { CategoryOrigin } from '../../schema/enums';
import { categories } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import {
  ensureSynced,
  getById,
  insertSynced,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';

export type Category = Row<typeof categories>;

/** Default categories created on every device with the same derived IDs (ADR-0015). */
export const SEED_CATEGORIES = [
  {
    slug: 'workout',
    name: 'Workout',
    description: 'Exercise and training: gym, running, sports, yoga, walks',
  },
  { slug: 'work', name: 'Work', description: 'Focused work, meetings, coding, studying' },
  { slug: 'diet', name: 'Diet', description: 'Meals, snacks, drinks and nutrition' },
  {
    slug: 'health',
    name: 'Health',
    description: 'Sleep, symptoms, pain, medication, body measurements',
  },
  {
    slug: 'reflection',
    name: 'Reflection',
    description: 'Thoughts, feelings, journaling, daily and weekly reviews',
  },
  { slug: 'other', name: 'Other', description: 'Anything that fits no other category' },
] as const;

export type SeedCategorySlug = (typeof SEED_CATEGORIES)[number]['slug'];

/** `other` is the fallback and `reflection` holds system briefs: they can't be archived or deleted. */
const REQUIRED_SEEDS: readonly SeedCategorySlug[] = ['other', 'reflection'];

/** Stable ID of a seed category (survives renames). */
export const seedCategoryId = (slug: SeedCategorySlug) => derivedId('category', slug);

const MAX_MERGE_HOPS = 10;

export function categoriesRepo(deps: RepoDeps) {
  /** Follow `merged_into_id` to the surviving category. */
  async function resolve(db: ClientDb, category: Category): Promise<Category> {
    let current = category;
    for (let hop = 0; current.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
      const next = await getById(db, categories, current.mergedIntoId);
      if (!next) break;
      current = next;
    }
    return current;
  }

  async function findBySlug(db: ClientDb, slug: string): Promise<Category | undefined> {
    const found = await db
      .select()
      .from(categories)
      .where(and(live(categories), eq(categories.slug, slug)))
      .orderBy(asc(categories.createdAt))
      .get();
    return found ? resolve(db, found) : undefined;
  }

  return {
    findBySlug,

    getById: (db: ClientDb, id: string) => getById(db, categories, id),

    /** Active (not archived, not merged) categories, oldest first. */
    listActive(db: ClientDb): Promise<Category[]> {
      return db
        .select()
        .from(categories)
        .where(
          and(live(categories), isNull(categories.archivedAt), isNull(categories.mergedIntoId)),
        )
        .orderBy(asc(categories.createdAt));
    },

    /** Slugs of merged categories with where they now point, so old names keep resolving. */
    async listMergedAliases(db: ClientDb): Promise<{ slug: string; id: string }[]> {
      const merged = await db
        .select()
        .from(categories)
        .where(and(live(categories), isNotNull(categories.mergedIntoId)));
      return Promise.all(
        merged.map(async (category) => ({
          slug: category.slug,
          id: (await resolve(db, category)).id,
        })),
      );
    },

    /** Idempotent; never overwrites a seed the user renamed. */
    async ensureSeeds(tx: Tx): Promise<void> {
      for (const seed of SEED_CATEGORIES) {
        await ensureSynced(tx, deps, categories, {
          id: seedCategoryId(seed.slug),
          name: seed.name,
          slug: seed.slug,
          description: seed.description,
          origin: 'seed',
        });
      }
    },

    /**
     * Returns the existing category with the same slug, or creates one. New IDs derive
     * from the slug so the same category created offline on two devices converges.
     */
    async create(
      tx: Tx,
      input: {
        name: string;
        description?: string | null;
        origin: Exclude<CategoryOrigin, 'seed'>;
        needsReview?: boolean;
      },
    ): Promise<Category> {
      const name = input.name.trim();
      const slug = slugify(name);
      if (!slug) throw new ValidationError('invalid_name', 'Category name is empty');

      const existing = await findBySlug(tx, slug);
      if (existing) return existing;

      const values = {
        name,
        slug,
        description: input.description ?? null,
        origin: input.origin,
        needsReview: input.needsReview ?? false,
        archivedAt: null,
        mergedIntoId: null,
      };
      const id = derivedId('category', slug);
      const holder = await getById(tx, categories, id);
      if (!holder || holder.deletedAt) {
        return upsertSynced(tx, deps, categories, { id, ...values });
      }
      // The derived ID belongs to a category that was renamed away from this slug.
      return insertSynced(tx, deps, categories, values);
    },

    async rename(tx: Tx, id: string, newName: string): Promise<Category> {
      const name = newName.trim();
      const slug = slugify(name);
      if (!slug) throw new ValidationError('invalid_name', 'Category name is empty');
      const clash = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(live(categories), eq(categories.slug, slug), ne(categories.id, id)))
        .get();
      if (clash) {
        throw new ValidationError('duplicate_name', 'A category with this name already exists');
      }
      return updateSynced(tx, deps, categories, id, { name, slug });
    },

    async markReviewed(tx: Tx, id: string): Promise<Category> {
      return updateSynced(tx, deps, categories, id, { needsReview: false });
    },

    async archive(tx: Tx, id: string): Promise<Category> {
      if (REQUIRED_SEEDS.some((slug) => seedCategoryId(slug) === id)) {
        throw new ValidationError('category_required', 'This category is required');
      }
      return updateSynced(tx, deps, categories, id, { archivedAt: deps.clock.now() });
    },

    async softDelete(tx: Tx, id: string): Promise<void> {
      const category = await getById(tx, categories, id);
      if (category?.origin === 'seed') {
        throw new ValidationError('category_required', 'Default categories can only be archived');
      }
      await softDeleteSynced(tx, deps, categories, [id]);
    },
  };
}
