//! SQLite storage. Two-pool model: read pool (size 8) and write pool (size 1)
//! over the same DB file. PRAGMAs installed per connection. Schema bootstrap
//! via a single collapsed migration (`migrations` module).

pub mod migrations;

use std::path::Path;
use std::sync::Arc;

use r2d2::{CustomizeConnection, Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use thiserror::Error;

pub const READ_POOL_SIZE: u32 = 8;
pub const WRITE_POOL_SIZE: u32 = 1;

/// 256 MiB mmap size. Matches better-sqlite3's default.
pub const MMAP_SIZE_BYTES: i64 = 268_435_456;

/// 64 MiB cache. Negative value = absolute KiB instead of pages.
pub const CACHE_SIZE_KIB: i64 = -64_000;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("r2d2 pool error: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),
}

/// Installs the PRAGMAs common to both pools. Used as a helper from the
/// read/write customizers.
fn apply_common_pragmas(conn: &mut Connection) -> Result<(), rusqlite::Error> {
    // journal_mode and synchronous are DB-wide; first connection wins.
    // The rest are per-connection and must be set every time.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "mmap_size", MMAP_SIZE_BYTES)?;
    conn.pragma_update(None, "cache_size", CACHE_SIZE_KIB)?;
    Ok(())
}

/// Read-pool customizer. Sets `query_only = ON` so any write attempted through
/// a read connection fails at the SQLite engine level — the two-pool design's
/// single-writer contract becomes load-bearing instead of convention.
#[derive(Debug)]
struct ReadPragmaCustomizer;

impl CustomizeConnection<Connection, rusqlite::Error> for ReadPragmaCustomizer {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        apply_common_pragmas(conn)?;
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(())
    }
}

/// Write-pool customizer. Does NOT set `query_only`; the single connection in
/// this pool is the only one allowed to mutate the database.
#[derive(Debug)]
struct WritePragmaCustomizer;

impl CustomizeConnection<Connection, rusqlite::Error> for WritePragmaCustomizer {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        apply_common_pragmas(conn)
    }
}

/// Read-only marker. Holds a connection from the read pool. The connection
/// has `PRAGMA query_only = ON` so any attempted write fails at the SQLite
/// engine level — this is the load-bearing enforcement of the single-writer
/// contract, not just a convention. Use for SELECT.
pub struct ReadConn(PooledConnection<SqliteConnectionManager>);
impl std::ops::Deref for ReadConn {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        &self.0
    }
}

/// Read-write marker. Holds the single connection from the write pool. Use
/// for INSERT / UPDATE / DELETE / transactions. Holding one of these blocks
/// every other writer system-wide — keep critical sections short.
///
/// **Never call `db.write()` while holding another `WriteConn`** — the write
/// pool has capacity 1 and `r2d2::Pool::get()` will block forever. This is
/// the only known way to deadlock the data layer.
pub struct WriteConn(PooledConnection<SqliteConnectionManager>);
impl std::ops::Deref for WriteConn {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        &self.0
    }
}
impl std::ops::DerefMut for WriteConn {
    fn deref_mut(&mut self) -> &mut Connection {
        &mut self.0
    }
}

#[derive(Clone)]
pub struct Db {
    read_pool: Pool<SqliteConnectionManager>,
    write_pool: Pool<SqliteConnectionManager>,
}

impl Db {
    /// Open a DB at `path`. Runs migrations under the write pool before either
    /// pool is exposed to the rest of the app. The parent directory must exist.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Arc<Self>, DbError> {
        let manager_read = SqliteConnectionManager::file(path.as_ref()).with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
        );
        let manager_write = SqliteConnectionManager::file(path.as_ref()).with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
        );

        let read_pool = Pool::builder()
            .max_size(READ_POOL_SIZE)
            .connection_customizer(Box::new(ReadPragmaCustomizer))
            .build(manager_read)?;
        let write_pool = Pool::builder()
            .max_size(WRITE_POOL_SIZE)
            .connection_customizer(Box::new(WritePragmaCustomizer))
            .build(manager_write)?;

        // Run migrations through the write pool so the same single-writer
        // contract holds during bootstrap.
        {
            let mut conn = write_pool.get()?;
            migrations::migrations().to_latest(&mut conn)?;
        }

        Ok(Arc::new(Self {
            read_pool,
            write_pool,
        }))
    }

    pub fn read(&self) -> Result<ReadConn, DbError> {
        Ok(ReadConn(self.read_pool.get()?))
    }

    pub fn write(&self) -> Result<WriteConn, DbError> {
        Ok(WriteConn(self.write_pool.get()?))
    }

    pub fn read_pool_size(&self) -> u32 {
        self.read_pool.max_size()
    }

    pub fn write_pool_size(&self) -> u32 {
        self.write_pool.max_size()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    use tempfile::TempDir;

    fn open_temp_db() -> (TempDir, Arc<Db>) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test.db");
        let db = Db::open(&path).expect("open db");
        (dir, db)
    }

    fn pragma<T: rusqlite::types::FromSql>(conn: &Connection, name: &str) -> T {
        conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
            .expect("pragma query")
    }

    #[test]
    fn open_creates_file_and_runs_migrations() {
        let (_dir, db) = open_temp_db();
        let conn = db.read().unwrap();
        let v: i64 = pragma(&conn, "user_version");
        assert_eq!(v, 1, "migrations must have run during open()");
    }

    #[test]
    fn pragmas_install_on_read_connections() {
        let (_dir, db) = open_temp_db();
        let conn = db.read().unwrap();
        assert_eq!(pragma::<String>(&conn, "journal_mode"), "wal");
        assert_eq!(pragma::<i64>(&conn, "synchronous"), 1, "NORMAL = 1");
        assert_eq!(pragma::<i64>(&conn, "foreign_keys"), 1);
        assert_eq!(pragma::<i64>(&conn, "mmap_size"), MMAP_SIZE_BYTES);
        // cache_size returns the configured value; can be negative (KiB).
        assert_eq!(pragma::<i64>(&conn, "cache_size"), CACHE_SIZE_KIB);
    }

    #[test]
    fn pragmas_install_on_write_connections() {
        let (_dir, db) = open_temp_db();
        let conn = db.write().unwrap();
        assert_eq!(pragma::<String>(&conn, "journal_mode"), "wal");
        assert_eq!(pragma::<i64>(&conn, "foreign_keys"), 1);
    }

    #[test]
    fn pool_sizes_match_spec() {
        let (_dir, db) = open_temp_db();
        assert_eq!(db.read_pool_size(), 8);
        assert_eq!(db.write_pool_size(), 1);
    }

    #[test]
    fn concurrent_reads_do_not_block() {
        let (_dir, db) = open_temp_db();
        let mut handles = Vec::new();
        for _ in 0..8 {
            let db = db.clone();
            handles.push(thread::spawn(move || {
                let conn = db.read().expect("read");
                let _: i64 = pragma(&conn, "user_version");
                thread::sleep(Duration::from_millis(20));
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn read_connection_rejects_writes() {
        let (_dir, db) = open_temp_db();
        // Seed a row through the write pool so we know the table exists.
        {
            let conn = db.write().unwrap();
            conn.execute(
                "INSERT INTO projects (id, name, path) VALUES ('p', 'p', '/p')",
                [],
            )
            .unwrap();
        }

        // A write attempted through the read pool must fail because the
        // connection has PRAGMA query_only = ON.
        let conn = db.read().unwrap();
        let result = conn.execute(
            "UPDATE projects SET name = 'should-not-stick' WHERE id = 'p'",
            [],
        );
        assert!(
            result.is_err(),
            "writes through ReadConn must be refused by SQLite (query_only=ON)"
        );
    }

    #[test]
    fn concurrent_writes_serialize_without_busy() {
        let (_dir, db) = open_temp_db();
        // Seed a project row so we have something to update under FK constraints.
        {
            let conn = db.write().unwrap();
            conn.execute(
                "INSERT INTO projects (id, name, path) VALUES ('p', 'p', '/p')",
                [],
            )
            .unwrap();
        }

        let mut handles = Vec::new();
        for i in 0..16 {
            let db = db.clone();
            handles.push(thread::spawn(move || {
                let conn = db.write().expect("write");
                conn.execute(
                    "UPDATE projects SET name = ? WHERE id = 'p'",
                    rusqlite::params![format!("name-{i}")],
                )
                .expect("update must not return SQLITE_BUSY thanks to write pool serialization");
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }
}
