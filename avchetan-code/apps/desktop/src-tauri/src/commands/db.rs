//! SQLite for the webviews (ADR-0019). Each window gets its own connection to the same
//! file, so one window's open transaction never interleaves with another's statements.
//! No business logic: statements come from Drizzle in the webview.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::{State, WebviewWindow};

use crate::error::{CommandError, CommandResult};

pub struct DbState {
    path: PathBuf,
    connections: Mutex<HashMap<String, Arc<Mutex<Connection>>>>,
}

impl DbState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn connection(&self, label: &str) -> CommandResult<Arc<Mutex<Connection>>> {
        let connections = self.connections.lock().map_err(|_| poisoned())?;
        connections
            .get(label)
            .cloned()
            .ok_or_else(|| CommandError::new("db_not_open", "Database not opened for this window"))
    }
}

fn poisoned() -> CommandError {
    CommandError::new("database_unavailable", "Database lock poisoned")
}

fn query_failed(error: rusqlite::Error) -> CommandError {
    CommandError::new("db_query_failed", error.to_string())
}

fn open_failed(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        "database_unavailable",
        format!("Could not open database: {error}"),
    )
}

fn open_connection(path: &Path) -> CommandResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(open_failed)?;
    }
    let connection = Connection::open(path).map_err(open_failed)?;
    connection
        .busy_timeout(Duration::from_millis(5000))
        .map_err(open_failed)?;
    // docs/conventions/database.md; foreign keys stay off (ADR-0011).
    connection
        .pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
        .map_err(open_failed)?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(open_failed)?;
    connection
        .pragma_update(None, "foreign_keys", "OFF")
        .map_err(open_failed)?;
    Ok(connection)
}

fn to_sql_values(params: Vec<Json>) -> CommandResult<Vec<Value>> {
    params
        .into_iter()
        .map(|param| match param {
            Json::Null => Ok(Value::Null),
            Json::Bool(flag) => Ok(Value::Integer(i64::from(flag))),
            Json::Number(number) => number
                .as_i64()
                .map(Value::Integer)
                .or_else(|| number.as_f64().map(Value::Real))
                .ok_or_else(|| CommandError::new("db_invalid_param", "Unsupported number")),
            Json::String(text) => Ok(Value::Text(text)),
            Json::Array(_) | Json::Object(_) => Err(CommandError::new(
                "db_invalid_param",
                "Parameters must be null, boolean, number or string",
            )),
        })
        .collect()
}

fn to_json(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(integer) => Json::from(integer),
        ValueRef::Real(real) => serde_json::Number::from_f64(real)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        ValueRef::Text(bytes) => Json::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Json::from(bytes.to_vec()),
    }
}

#[derive(Serialize)]
pub struct DbInfo {
    path: String,
}

/// Opens (or reopens) this window's connection. Reopening drops any transaction a
/// reloaded webview left open.
#[tauri::command(async)]
pub fn db_open(window: WebviewWindow, state: State<'_, DbState>) -> CommandResult<DbInfo> {
    let connection = open_connection(&state.path)?;
    state
        .connections
        .lock()
        .map_err(|_| poisoned())?
        .insert(window.label().to_owned(), Arc::new(Mutex::new(connection)));
    Ok(DbInfo {
        path: state.path.display().to_string(),
    })
}

/// One statement and its parameters.
#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    params: Vec<Json>,
}

/// Executes a statement, discarding any rows it returns (PRAGMAs return some).
fn execute(connection: &Connection, statement: Statement) -> CommandResult<()> {
    let mut prepared = connection.prepare(&statement.sql).map_err(query_failed)?;
    let mut rows = prepared
        .query(params_from_iter(to_sql_values(statement.params)?))
        .map_err(query_failed)?;
    while rows.next().map_err(query_failed)?.is_some() {}
    Ok(())
}

/// Runs a query and returns rows as arrays of column values, in select order (what
/// Drizzle's sqlite-proxy driver expects).
fn query(connection: &Connection, statement: Statement) -> CommandResult<Vec<Vec<Json>>> {
    let mut prepared = connection.prepare(&statement.sql).map_err(query_failed)?;
    let column_count = prepared.column_count();
    let mut rows = prepared
        .query(params_from_iter(to_sql_values(statement.params)?))
        .map_err(query_failed)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(query_failed)? {
        let mut values = Vec::with_capacity(column_count);
        for index in 0..column_count {
            values.push(to_json(row.get_ref(index).map_err(query_failed)?));
        }
        result.push(values);
    }
    Ok(result)
}

#[tauri::command(async)]
pub fn db_run(
    window: WebviewWindow,
    state: State<'_, DbState>,
    sql: String,
    params: Vec<Json>,
) -> CommandResult<()> {
    let connection = state.connection(window.label())?;
    let connection = connection.lock().map_err(|_| poisoned())?;
    execute(&connection, Statement { sql, params })
}

#[tauri::command(async)]
pub fn db_values(
    window: WebviewWindow,
    state: State<'_, DbState>,
    sql: String,
    params: Vec<Json>,
) -> CommandResult<Vec<Vec<Json>>> {
    let connection = state.connection(window.label())?;
    let connection = connection.lock().map_err(|_| poisoned())?;
    query(&connection, Statement { sql, params })
}

/// Executes `statements` in order, stopping at the first failure, then runs `query` if
/// given. Lets the webview send a transaction's deferred writes in one IPC call.
#[tauri::command(async)]
pub fn db_batch(
    window: WebviewWindow,
    state: State<'_, DbState>,
    statements: Vec<Statement>,
    query: Option<Statement>,
) -> CommandResult<Option<Vec<Vec<Json>>>> {
    let connection = state.connection(window.label())?;
    let connection = connection.lock().map_err(|_| poisoned())?;
    for statement in statements {
        execute(&connection, statement)?;
    }
    query
        .map(|statement| self::query(&connection, statement))
        .transpose()
}

/// Rolls back the open transaction, if any. A batch that failed at `BEGIN` leaves none
/// open, and a plain `ROLLBACK` would then fail and hide the original error.
#[tauri::command(async)]
pub fn db_rollback(window: WebviewWindow, state: State<'_, DbState>) -> CommandResult<()> {
    let connection = state.connection(window.label())?;
    let connection = connection.lock().map_err(|_| poisoned())?;
    if connection.is_autocommit() {
        return Ok(());
    }
    connection.execute_batch("ROLLBACK").map_err(query_failed)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    /// ADR-0029: the bundled SQLite has FTS5, and the tokenizer the search index uses keeps
    /// Devanagari words whole (vowel signs are category M, which plain unicode61 splits on).
    #[test]
    fn fts5_keeps_devanagari_words_whole() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE VIRTUAL TABLE f USING fts5(c, tokenize = \"unicode61 categories 'L* N* Co M*'\");
                 INSERT INTO f(c) VALUES ('दिल्ली में दौड़ लगाई'), ('Ran 5 km in the park');",
            )
            .unwrap();
        let count = |query: &str| -> i64 {
            connection
                .query_row("SELECT count(*) FROM f WHERE f MATCH ?1", [query], |row| {
                    row.get(0)
                })
                .unwrap()
        };
        assert_eq!(count("दिल्ली"), 1);
        assert_eq!(count("दौड़"), 1);
        assert_eq!(count("दिल*"), 1);
        assert_eq!(count("ल"), 0, "a fragment of a word must not match");
        assert_eq!(count("park"), 1);
    }

    /// The real client migrations, run one statement at a time through `execute` as the
    /// webview's migration runner does, build the search index on the bundled SQLite: its
    /// triggers (one statement each, with inner semicolons) and `json_each` work here.
    #[test]
    fn client_migrations_build_the_search_index() {
        const MIGRATIONS: [&str; 4] = [
            include_str!("../../../../../packages/db/migrations/sqlite/0000_init.sql"),
            include_str!(
                "../../../../../packages/db/migrations/sqlite/0001_example_forgotten_at.sql"
            ),
            include_str!("../../../../../packages/db/migrations/sqlite/0002_tag_makes_private.sql"),
            include_str!("../../../../../packages/db/migrations/sqlite/0003_search_index.sql"),
        ];
        let connection = Connection::open_in_memory().unwrap();
        let run = |sql: &str| {
            super::execute(
                &connection,
                super::Statement {
                    sql: sql.to_owned(),
                    params: vec![],
                },
            )
            .unwrap();
        };
        for migration in MIGRATIONS {
            migration
                .split("--> statement-breakpoint")
                .map(str::trim)
                .filter(|statement| !statement.is_empty())
                .for_each(run);
        }
        run(
            "INSERT INTO raw_logs (id, created_at, updated_at, updated_by_device, content,
             captured_at, captured_tz, source, status, origin_device_id)
             VALUES ('l1', 't', 't', 'd', 'दिल्ली में दौड़ लगाई', 't', 'UTC', 'desktop_text',
             'processed', 'd')",
        );
        run(
            "INSERT INTO entities (id, created_at, updated_at, updated_by_device, kind, name,
             normalized_name, aliases) VALUES ('e1', 't', 't', 'd', 'person', 'Rahul Verma',
             'rahul verma', '[\"Rahul V\"]')",
        );
        let count = |query: &str| -> i64 {
            connection
                .query_row(
                    "SELECT count(*) FROM search_index WHERE search_index MATCH ?1",
                    [query],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(count("\"दौड़\"*"), 1);
        assert_eq!(count("\"ड\"*"), 0);
        assert_eq!(count("\"verma\"*"), 1);
        run("UPDATE raw_logs SET deleted_at = 't2' WHERE id = 'l1'");
        assert_eq!(count("\"दौड़\"*"), 0);
    }
}
