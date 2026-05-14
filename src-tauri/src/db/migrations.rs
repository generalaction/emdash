//! Collapsed bootstrap migration. Mirrors the Electron final-state schema
//! (`src/main/db/schema.ts`) except `app_secrets`, which uses the AEAD schema
//! defined by EMD-6.

use rusqlite_migration::{Migrations, M};

/// Public so `Db::open` and the tests below share the same handle.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(BOOTSTRAP_SQL)])
}

const BOOTSTRAP_SQL: &str = r#"
-- ssh_connections ----------------------------------------------------------
CREATE TABLE ssh_connections (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    host text NOT NULL,
    port integer NOT NULL DEFAULT 22,
    username text NOT NULL,
    auth_type text NOT NULL DEFAULT 'agent',
    private_key_path text,
    use_agent integer NOT NULL DEFAULT 0,
    metadata text,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_ssh_connections_name ON ssh_connections (name);
CREATE INDEX idx_ssh_connections_host ON ssh_connections (host);

-- projects -----------------------------------------------------------------
CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    workspace_provider text NOT NULL DEFAULT 'local',
    base_ref text,
    ssh_connection_id text REFERENCES ssh_connections(id) ON DELETE SET NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_projects_path ON projects (path);
CREATE INDEX idx_projects_ssh_connection_id ON projects (ssh_connection_id);

-- project_remotes ----------------------------------------------------------
CREATE TABLE project_remotes (
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    remote_name text NOT NULL,
    remote_url text NOT NULL,
    PRIMARY KEY (project_id, remote_name)
);

-- project_settings ---------------------------------------------------------
CREATE TABLE project_settings (
    project_id text PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_project_settings_json text NOT NULL DEFAULT '{}',
    shareable_project_settings_json text NOT NULL DEFAULT '{}',
    legacy_config_migrated_at text,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- app_settings -------------------------------------------------------------
CREATE TABLE app_settings (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL,
    updated_at integer NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key);

-- tasks --------------------------------------------------------------------
CREATE TABLE tasks (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL,
    status text NOT NULL,
    source_branch text,
    task_branch text,
    linked_issue text,
    archived_at text,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interacted_at text,
    status_changed_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_pinned integer NOT NULL DEFAULT 0,
    workspace_provider text,
    workspace_id text,
    workspace_provider_data text
);
CREATE INDEX idx_tasks_project_id ON tasks (project_id);

-- workspaces ---------------------------------------------------------------
CREATE TABLE workspaces (
    id text PRIMARY KEY NOT NULL,
    key text,
    type text NOT NULL,
    data text,
    path text,
    lines_added integer,
    lines_deleted integer,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_workspaces_key ON workspaces (key) WHERE key IS NOT NULL;

-- pull_request_users -------------------------------------------------------
CREATE TABLE pull_request_users (
    user_id text PRIMARY KEY NOT NULL,
    user_name text NOT NULL,
    display_name text,
    avatar_url text,
    url text,
    user_updated_at text,
    user_created_at text
);

-- pull_requests ------------------------------------------------------------
CREATE TABLE pull_requests (
    url text PRIMARY KEY NOT NULL,
    provider text NOT NULL DEFAULT 'github',
    repository_url text NOT NULL,
    base_ref_name text NOT NULL,
    base_ref_oid text NOT NULL,
    head_repository_url text NOT NULL,
    head_ref_name text NOT NULL,
    head_ref_oid text NOT NULL,
    identifier text,
    title text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'open',
    is_draft integer,
    author_user_id text REFERENCES pull_request_users(user_id) ON DELETE SET NULL,
    additions integer,
    deletions integer,
    changed_files integer,
    commit_count integer,
    mergeable_status text,
    merge_state_status text,
    review_decision text,
    pull_request_created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pull_request_updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_pull_requests_url ON pull_requests (url);
CREATE INDEX idx_pull_requests_repository_url ON pull_requests (repository_url);
CREATE INDEX idx_pull_requests_head_repository_url ON pull_requests (head_repository_url);

-- pull_request_labels ------------------------------------------------------
CREATE TABLE pull_request_labels (
    pull_request_id text NOT NULL REFERENCES pull_requests(url) ON DELETE CASCADE,
    name text NOT NULL,
    color text,
    PRIMARY KEY (pull_request_id, name)
);
CREATE INDEX idx_prl_name ON pull_request_labels (name);

-- pull_request_assignees ---------------------------------------------------
CREATE TABLE pull_request_assignees (
    pull_request_url text NOT NULL REFERENCES pull_requests(url) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES pull_request_users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (pull_request_url, user_id)
);
CREATE INDEX idx_pra_pull_request_url ON pull_request_assignees (pull_request_url);
CREATE INDEX idx_pra_user_id ON pull_request_assignees (user_id);

-- pull_request_checks ------------------------------------------------------
CREATE TABLE pull_request_checks (
    id text PRIMARY KEY NOT NULL,
    pull_request_url text NOT NULL REFERENCES pull_requests(url) ON DELETE CASCADE,
    commit_sha text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    conclusion text NOT NULL,
    details_url text,
    started_at text,
    completed_at text,
    workflow_name text,
    app_name text,
    app_logo_url text
);
CREATE INDEX idx_prc_pull_request_url ON pull_request_checks (pull_request_url);

-- conversations ------------------------------------------------------------
CREATE TABLE conversations (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title text NOT NULL,
    provider text,
    config text,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interacted_at text,
    is_initial_conversation integer
);
CREATE INDEX idx_conversations_task_id ON conversations (task_id);

-- terminals ----------------------------------------------------------------
CREATE TABLE terminals (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    ssh integer NOT NULL DEFAULT 0,
    name text NOT NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_terminals_task_id ON terminals (task_id);

-- messages -----------------------------------------------------------------
CREATE TABLE messages (
    id text PRIMARY KEY NOT NULL,
    conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    content text NOT NULL,
    sender text NOT NULL,
    timestamp text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata text
);
CREATE INDEX idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX idx_messages_timestamp ON messages (timestamp);

-- editor_buffers -----------------------------------------------------------
CREATE TABLE editor_buffers (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id text NOT NULL,
    file_path text NOT NULL,
    content text NOT NULL,
    updated_at integer NOT NULL
);
CREATE INDEX idx_editor_buffers_workspace_file ON editor_buffers (workspace_id, file_path);

-- kv -----------------------------------------------------------------------
CREATE TABLE kv (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL,
    updated_at integer NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_kv_key ON kv (key);

-- app_secrets (EMD-6 AEAD schema — replaces the Electron app_secrets) ------
CREATE TABLE app_secrets (
    key text PRIMARY KEY NOT NULL,
    nonce blob NOT NULL,
    ciphertext blob NOT NULL,
    aad blob NOT NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_app_secrets_key ON app_secrets (key);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        migrations()
            .to_latest(&mut conn)
            .expect("apply migrations to latest");
        conn
    }

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
            )
            .unwrap();
        let names: rusqlite::Result<Vec<String>> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect();
        names.unwrap()
    }

    #[test]
    fn fresh_apply_creates_expected_tables() {
        let conn = fresh_db();
        let names = table_names(&conn);

        // Every table the Electron final-state schema defines, plus the new
        // AEAD app_secrets. No more, no less.
        let expected: &[&str] = &[
            "app_secrets",
            "app_settings",
            "conversations",
            "editor_buffers",
            "kv",
            "messages",
            "project_remotes",
            "project_settings",
            "projects",
            "pull_request_assignees",
            "pull_request_checks",
            "pull_request_labels",
            "pull_request_users",
            "pull_requests",
            "ssh_connections",
            "tasks",
            "terminals",
            "workspaces",
        ];
        let expected: Vec<String> = expected.iter().map(|s| s.to_string()).collect();
        assert_eq!(names, expected, "table set drift — update collapsed SQL");
    }

    #[test]
    fn user_version_advances_to_one() {
        let conn = fresh_db();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(v, 1, "PRAGMA user_version must reflect migration count");
    }

    #[test]
    fn app_secrets_has_aead_columns() {
        let conn = fresh_db();
        let cols: Vec<(String, String, i64)> = conn
            .prepare("PRAGMA table_info(app_secrets)")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?, // name
                    row.get::<_, String>(2)?, // type
                    row.get::<_, i64>(3)?,    // notnull
                ))
            })
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        let by_name: std::collections::HashMap<_, _> = cols
            .iter()
            .map(|(n, t, nn)| (n.as_str(), (t.as_str(), *nn)))
            .collect();

        assert_eq!(by_name.get("key"), Some(&("TEXT", 1)));
        assert_eq!(by_name.get("nonce"), Some(&("BLOB", 1)));
        assert_eq!(by_name.get("ciphertext"), Some(&("BLOB", 1)));
        assert_eq!(by_name.get("aad"), Some(&("BLOB", 1)));
        assert!(by_name.contains_key("created_at"));
        assert!(by_name.contains_key("updated_at"));
    }

    #[test]
    fn app_secrets_key_is_unique() {
        let conn = fresh_db();
        conn.execute(
            "INSERT INTO app_secrets (key, nonce, ciphertext, aad, created_at, updated_at) \
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            rusqlite::params!["k", &[0u8; 12][..], &[0u8; 16][..], b"aad".as_slice()],
        )
        .unwrap();

        let result = conn.execute(
            "INSERT INTO app_secrets (key, nonce, ciphertext, aad, created_at, updated_at) \
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            rusqlite::params!["k", &[0u8; 12][..], &[0u8; 16][..], b"aad".as_slice()],
        );
        assert!(
            result.is_err(),
            "duplicate key must be rejected by uniqueness"
        );
    }

    #[test]
    fn migrations_are_idempotent_when_reapplied() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        migrations()
            .to_latest(&mut conn)
            .expect("re-running to_latest on an up-to-date db is a no-op");
    }
}
