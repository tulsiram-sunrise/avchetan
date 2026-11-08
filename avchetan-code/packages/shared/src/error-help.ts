/**
 * Every error code a user can see → what to tell them → where the fix is
 * (docs/user-guide/troubleshooting.md; `pnpm errors:check` keeps both sides complete).
 *
 * - `section`: the guide heading to link, or `null` when the message is the whole fix
 *   (an empty name, a duplicate). Several codes may share one section.
 * - `message`: plain text shown instead of the thrown one, or `null` when the thrown message
 *   is already written for the user (it may carry a detail, like the provider's HTTP status).
 *
 * No imports: tooling/scripts/check-error-codes.ts loads this file directly.
 */
export type ErrorHelp = { section: string | null; message: string | null };

const own = (message: string | null = null): ErrorHelp => ({ section: null, message });
const at = (section: string, message: string | null = null): ErrorHelp => ({ section, message });

const BUG =
  'Something inside Avchetan went wrong. Restart it; if it happens again, please report it';

export const ERROR_HELP = {
  // Input the user can correct on the spot.
  category_required: own(),
  duplicate_name: own(),
  empty_capture: own(),
  invalid_date: own('That date is not valid'),
  invalid_merge: own(),
  invalid_name: own(),
  invalid_tag: own(),
  invalid_title: own(),
  invalid_time_zone: own('Unknown time zone. Choose one from the list'),
  not_found: own('That item no longer exists. It may have been deleted on another device'),
  hotkey_invalid: own('That shortcut isn’t valid. Choose another'),

  // This device's database.
  database_unavailable: at('database_unavailable', 'Avchetan couldn’t open its database'),
  db_not_open: at('database_unavailable', 'Avchetan couldn’t open its database'),
  db_locked: at('database_unavailable', 'The database is busy. Try again in a moment'),
  migration_failed: at('database_unavailable', 'Avchetan couldn’t update its database'),
  db_newer_than_app: at(
    'db_newer_than_app',
    'Your data was saved by a newer Avchetan. Install the latest version',
  ),
  db_query_failed: at('db_query_failed', 'Couldn’t save this change'),
  rollback_failed: at('db_query_failed', 'Couldn’t save this change'),
  db_invalid_param: at('other_errors', BUG),

  // Backups and exports.
  backup_failed: at('backup_failed', 'Couldn’t back up the database'),
  backup_invalid: at('backup_invalid', 'Invalid backup name'),
  export_failed: at('export_failed', 'Couldn’t save the export'),
  export_invalid: at('export_invalid', 'Invalid export file name'),
  open_failed: at('open_failed', 'Couldn’t open the folder'),
  restore_target_not_empty: at('restore_target_not_empty'),

  // Desktop plumbing.
  dock_unavailable: at('dock_unavailable'),
  hotkey_unavailable: at('hotkey_unavailable', 'The shortcut is used by another app'),
  secret_store_failed: at(
    'secret_store_failed',
    'Couldn’t reach this device’s password store, where Avchetan keeps keys and tokens',
  ),
  secret_invalid_name: at('other_errors', BUG),

  // App lock (docs/product/app-lock.md).
  app_locked: own('Unlock Avchetan first'),
  app_lock_unavailable: at(
    'app_lock_unavailable',
    'This device has no screen lock Avchetan can use. Set one up first',
  ),
  ipc_failed: at('other_errors', BUG),

  // Voice capture (docs/product/voice-capture.md).
  mic_unavailable: at(
    'mic_unavailable',
    'No microphone found. Plug one in, or pick one in Settings → Voice',
  ),
  mic_permission_denied: at('mic_permission_denied', 'The microphone is blocked for Avchetan'),
  speech_model_missing: at(
    'speech_model_missing',
    'Voice needs a speech model. Download one in Settings → Voice',
  ),
  speech_model_download_failed: at(
    'speech_model_download_failed',
    'The speech model didn’t download. Check your connection and try again',
  ),
  speech_model_delete_failed: at(
    'speech_model_download_failed',
    'Couldn’t delete the speech model. Restart Avchetan and try again',
  ),
  speech_offline_unavailable: at(
    'speech_offline_unavailable',
    'This phone can’t recognise speech offline in that language yet',
  ),
  speech_unsupported_cpu: at(
    'speech_unsupported_cpu',
    'This PC’s processor is too old for voice. Typing still works',
  ),
  transcription_failed: at('transcription_failed', 'Couldn’t turn that into text. Try again'),
  voice_unavailable: at('other_errors', BUG),
  cancelled: own('Cancelled'),
  invalid_input: at('other_errors', BUG),
  ipc_invalid_result: at('other_errors', BUG),
  unknown_action: at('other_errors', 'The app needs a restart'),
  invalid_view: at('other_errors', BUG),
  window_failed: at('other_errors', BUG),
  tray_failed: at('other_errors', BUG),
  notification_failed: at('other_errors', BUG),
  internal: at('other_errors', BUG),

  // The Home Hub inside the desktop app.
  hub_port_in_use: at('hub_port_in_use'),
  hub_crashed: at('hub_crashed', 'Couldn’t start the hub'),
  hub_start_failed: at('hub_crashed', 'Couldn’t start the hub'),
  hub_program_missing: at(
    'hub_program_missing',
    'The hub program isn’t installed with this copy of Avchetan',
  ),
  hub_token_missing: at('hub_token_missing'),
  hub_config_failed: at('hub_config_failed', 'Couldn’t save the hub’s settings'),
  hub_invalid_config: at('other_errors', BUG),
  hub_running: at('hub_running', 'Turn the hub off before using other hub data'),
  hub_import_failed: at('hub_import_failed', 'Couldn’t copy the hub data'),
  hub_import_not_hub_data: at('hub_import_not_hub_data', 'That folder doesn’t hold hub data'),
  hub_import_target_not_empty: at(
    'hub_import_target_not_empty',
    'The built-in hub already has data',
  ),
  hub_restore_failed: at(
    'hub_restore_failed',
    'The backup couldn’t be restored; the hub kept its data',
  ),
  hub_backup_failed: at('hub_backup_failed', 'Couldn’t read the hub’s backups'),
  hub_backup_invalid: at('hub_backup_invalid', 'Not a hub backup, or that backup is gone'),

  // What a hub needs on this PC (the hub checklist and the Setup check).
  ollama_not_running: at('ollama_not_running'),
  model_missing: at('model_missing'),
  network_public: at('network_public'),
  network_check_failed: at('network_check_failed', 'Couldn’t check this PC’s network'),
  network_check_unsupported: at('network_check_failed', 'Couldn’t check this PC’s network'),
  firewall_declined: at('firewall_declined', 'Windows wasn’t allowed to add the firewall rule'),
  firewall_failed: at('firewall_failed', 'Adding the firewall rule failed'),
  tailscale: at('tailscale'),

  // Sync, as this device sees it.
  server_unreachable: at('server_unreachable', 'Can’t reach your hub or server'),
  unauthorized: at('unauthorized', 'Your hub or server refused this device’s sync token'),
  unknown_device: at('unauthorized', 'Your hub doesn’t know this device. Pair it again'),
  forbidden: at('other_errors', BUG),
  clock_skew: at('clock_skew'),
  sync_issue: at('sync_issue'),
  not_configured: at('not_configured', 'Set up Sync on this device first'),
  untrusted_local_network: at('untrusted_local_network'),
  insecure_server_url: at('insecure_server_url'),
  insecure_model_url: at('insecure_model_url'),
  model_url_required: own(),
  invalid_pairing_code: at('invalid_pairing_code'),
  wrong_server: at('wrong_server'),
  no_pairing_address: at('no_pairing_address'),
  protocol_unsupported: at(
    'protocol_unsupported',
    'This app and your hub or server are different versions. Update the older one',
  ),
  rate_limited: at('rate_limited', 'Your hub got too many requests from this device'),
  bad_response: at('server_error', 'Your hub or server sent something unexpected'),
  server_error: at('server_error', 'Your hub or server answered with an error'),
  validation: at('server_error', 'Your hub or server didn’t accept the request'),
  payload_too_large: at('server_error', 'Your hub or server didn’t accept the request'),
  unavailable: at('server_error', 'Your hub or server can’t reach its database'),
  token_from_env: at('token_from_env'),
  ask_unavailable: at('ask_unavailable', 'Your hub can’t answer questions right now'),

  // Command mode in the capture box (docs/product/command-mode.md).
  command_unknown: at('command_unknown', 'Couldn’t read this as a command'),
  command_no_match: at('command_no_match'),
  search_unavailable: at('search_unavailable', 'Your hub can’t search by meaning right now'),

  // AI models: the thrown messages already say what happened, with the provider's detail.
  llm_auth: at('llm_auth'),
  llm_rate_limit: at('llm_rate_limit'),
  llm_unavailable: at('llm_unavailable'),
  llm_invalid_output: at('llm_invalid_output'),
  llm_refused: at('llm_refused'),
  llm_context_overflow: at('llm_context_overflow'),
  llm_no_credit: at('llm_no_credit'),

  // Written to the cloud server's log at startup (apps/server/src/db/startup-hint.ts).
  database_url_invalid: at('database_url_invalid'),
  database_ipv6_unreachable: at('database_ipv6_unreachable'),
  database_certificate_missing: at('database_certificate_missing'),
  database_password_wrong: at('database_password_wrong'),
} satisfies Record<string, ErrorHelp>;

export type KnownErrorCode = keyof typeof ERROR_HELP;

/** Unknown codes land here: what to try, and how to report it. */
export const OTHER_ERRORS_SECTION = 'other_errors';

function helpFor(code: string): ErrorHelp | undefined {
  return Object.hasOwn(ERROR_HELP, code) ? ERROR_HELP[code as KnownErrorCode] : undefined;
}

/** The guide section for a code, or null when the message needs no help page. */
export function helpSection(code: string): string | null {
  const help = helpFor(code);
  return help ? help.section : OTHER_ERRORS_SECTION;
}

/** What to show for an error: its plain message (no final full stop) and its guide section. */
export function describeError(error: { code: string; message: string }): {
  message: string;
  section: string | null;
} {
  const help = helpFor(error.code);
  return {
    message: help?.message ?? error.message,
    section: help ? help.section : OTHER_ERRORS_SECTION,
  };
}

/** Splits a raw log's `code: message`, as stored by the pending processor. */
export function parseLastError(lastError: string): { code: string; message: string } {
  const [code = '', ...message] = lastError.split(': ');
  return { code, message: message.join(': ') };
}

/** The plain message for a known code, for text that names a problem before any error exists. */
export function errorMessage(code: KnownErrorCode): string {
  const help: ErrorHelp = ERROR_HELP[code];
  return help.message ?? code;
}
