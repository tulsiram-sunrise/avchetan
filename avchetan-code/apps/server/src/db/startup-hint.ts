const HELP = 'https://tulsiram-sunrise.github.io/avchetan/user-guide/troubleshooting';

export type DatabaseStartupHint = { code: string; fix: string; help: string };

const hint = (code: string, fix: string): DatabaseStartupHint => ({
  code,
  fix,
  help: `${HELP}#${code}`,
});

const field = (error: unknown, name: string): unknown =>
  typeof error === 'object' && error !== null && name in error
    ? (error as Record<string, unknown>)[name]
    : undefined;

/**
 * What to tell a self-hoster when the server can't open its Postgres database, for the mistakes
 * setup-cloud.md users actually hit. Only ever reads error codes and fields, never the URL itself,
 * because it holds the password.
 */
export function databaseStartupHint(error: unknown): DatabaseStartupHint | null {
  const code = field(error, 'code');
  if (code === 'ERR_INVALID_URL' || error instanceof URIError) {
    return hint(
      'database_url_invalid',
      'DATABASE_URL is not a valid address. Check it starts with postgresql://, has no spaces, and that the password has only letters and numbers (#, /, ? and % break it).',
    );
  }
  if (code === 'ENETUNREACH' && String(field(error, 'address') ?? '').includes(':')) {
    return hint(
      'database_ipv6_unreachable',
      "The database address is IPv6 only, and this host can't reach IPv6. On Supabase, copy the Session pooler string instead of the Direct connection one.",
    );
  }
  // Opening a database reads no files except the certificates named in the URL.
  if (code === 'ENOENT') {
    return hint(
      'database_certificate_missing',
      'The database certificate file named in sslrootcert is missing. Add it as a secret file with that exact name.',
    );
  }
  if (code === '28P01') {
    return hint(
      'database_password_wrong',
      'The database rejected the password in DATABASE_URL. Reset the database password and paste the new one into DATABASE_URL.',
    );
  }
  return null;
}
