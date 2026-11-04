import { describe, expect, it } from 'vitest';
import { openPostgres } from './client';
import { databaseStartupHint } from './startup-hint';

const pooler = 'aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

/** The error `pg` itself throws for this URL, before it opens a socket. */
async function errorFor(url: string): Promise<unknown> {
  const database = await openPostgres(url);
  try {
    await database.migrate(() => '2026-11-04T10:00:00.000Z');
  } catch (error) {
    return error;
  } finally {
    await database.close().catch(() => undefined);
  }
  throw new Error('expected the database to fail');
}

describe('databaseStartupHint', () => {
  it.each(['ab#cd', 'ab/cd', 'ab?cd', 'ab%cd'])(
    'names DATABASE_URL when the password %s breaks the address',
    async (password) => {
      const error = await errorFor(`postgresql://postgres.abc:${password}@${pooler}`);
      expect(databaseStartupHint(error)?.code).toBe('database_url_invalid');
    },
  );

  it('points at the certificate when sslrootcert names a missing file', async () => {
    const error = await errorFor(
      `postgresql://postgres.abc:pw@${pooler}?sslmode=verify-full&sslrootcert=./missing-ca.crt`,
    );
    expect(databaseStartupHint(error)?.code).toBe('database_certificate_missing');
  });

  it('suggests the session pooler when only an IPv6 address was unreachable', () => {
    const error = Object.assign(new Error('connect ENETUNREACH 2406:da14::1:5432'), {
      code: 'ENETUNREACH',
      address: '2406:da14::1',
    });
    expect(databaseStartupHint(error)?.code).toBe('database_ipv6_unreachable');
    expect(databaseStartupHint({ code: 'ENETUNREACH', address: '10.0.0.1' })).toBeNull();
  });

  it('names a wrong password, and stays quiet about anything else', () => {
    expect(databaseStartupHint({ code: '28P01' })?.code).toBe('database_password_wrong');
    expect(databaseStartupHint(new Error('something else'))).toBeNull();
    expect(databaseStartupHint('not an error')).toBeNull();
  });

  it('links each fix to its troubleshooting section', () => {
    expect(databaseStartupHint({ code: '28P01' })?.help).toMatch(
      /\/user-guide\/troubleshooting#database_password_wrong$/,
    );
  });
});
