use crate::models::{ModelProfile, ProviderAccount};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex};

pub struct Database {
    connection: Mutex<Connection>,
    #[allow(dead_code)]
    pub root: PathBuf,
}

impl Database {
    pub fn open() -> Result<Self, String> {
        #[cfg(debug_assertions)]
        let root = std::env::var_os("AIPIN_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| dirs::data_local_dir().map(|path| path.join("AiPin")))
            .ok_or_else(|| "无法确定本地数据目录".to_string())?;
        #[cfg(not(debug_assertions))]
        let root = dirs::data_local_dir()
            .ok_or_else(|| "无法确定本地数据目录".to_string())?
            .join("AiPin");
        fs::create_dir_all(root.join("attachments"))
            .map_err(|_| "无法创建 AiPin 数据目录".to_string())?;
        fs::create_dir_all(root.join("backups"))
            .map_err(|_| "无法创建数据库备份目录".to_string())?;
        let path = root.join("aipin.db");
        let existed_before = path.exists();
        let mut connection =
            Connection::open(path).map_err(|error| format!("数据库打开失败：{error}"))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| error.to_string())?;
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|error| format!("数据库完整性检查失败：{error}"))?;
        if integrity != "ok" {
            return Err(format!("数据库损坏，原文件已保留：{integrity}"));
        }
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if existed_before && version < 1 {
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|error| error.to_string())?;
            let backup = root.join("backups").join(format!(
                "aipin-{}.db",
                chrono::Utc::now().format("%Y%m%d-%H%M%S")
            ));
            fs::copy(root.join("aipin.db"), backup)
                .map_err(|error| format!("迁移前备份失败：{error}"))?;
        }
        Self::migrate(&mut connection)?;
        let mut backups = fs::read_dir(root.join("backups"))
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .collect::<Vec<_>>();
        backups.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
        for entry in backups.into_iter().skip(5) {
            let _ = fs::remove_file(entry.path());
        }
        for entry in fs::read_dir(root.join("attachments")).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().is_some_and(|extension| extension == "tmp") {
                let _ = fs::remove_file(path);
            }
        }
        Ok(Self {
            connection: Mutex::new(connection),
            root,
        })
    }

    fn migrate(connection: &mut Connection) -> Result<(), String> {
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if version > 1 {
            return Err("数据库由更新版本的 AiPin 创建；为保护数据，本版本拒绝写入".to_string());
        }
        if version == 1 {
            return Ok(());
        }
        let tx = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        tx.execute_batch(
            r#"
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE provider_accounts(
              id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, alias TEXT NOT NULL, base_url TEXT NOT NULL,
              protocol TEXT NOT NULL, auth TEXT NOT NULL, secret_ref TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
            );
            CREATE TABLE model_profiles(
              id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES provider_accounts(id), provider TEXT NOT NULL,
              provider_name TEXT NOT NULL, remote_model_id TEXT NOT NULL, display_name TEXT NOT NULL,
              color TEXT NOT NULL, enabled INTEGER NOT NULL, capabilities_json TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE model_capabilities(profile_id TEXT PRIMARY KEY REFERENCES model_profiles(id), values_json TEXT NOT NULL, source TEXT NOT NULL, tested_at TEXT);
            CREATE TABLE workspace_slots(id TEXT PRIMARY KEY, profile_id TEXT REFERENCES model_profiles(id), reading_order INTEGER NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE layouts(id TEXT PRIMARY KEY, name TEXT NOT NULL, columns INTEGER NOT NULL, rows INTEGER NOT NULL, custom_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE pane_constraints(pane_id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES layouts(id), min_width REAL NOT NULL, min_height REAL NOT NULL, max_width REAL NOT NULL, max_height REAL NOT NULL, flex_x REAL NOT NULL, flex_y REAL NOT NULL, locked INTEGER NOT NULL, rect_json TEXT NOT NULL);
            CREATE TABLE comparison_sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, layout_snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
            CREATE TABLE model_threads(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES comparison_sessions(id), profile_id TEXT REFERENCES model_profiles(id), identity_snapshot_json TEXT NOT NULL, context_enabled INTEGER NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE prompt_batches(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES comparison_sessions(id), user_text TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
            CREATE TABLE prompt_batch_targets(batch_id TEXT NOT NULL REFERENCES prompt_batches(id), thread_id TEXT NOT NULL REFERENCES model_threads(id), state TEXT NOT NULL, PRIMARY KEY(batch_id, thread_id));
            CREATE TABLE messages(id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES model_threads(id), batch_id TEXT REFERENCES prompt_batches(id), role TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE message_content_blocks(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, block_index INTEGER NOT NULL, kind TEXT NOT NULL, content_text TEXT, attachment_id TEXT, UNIQUE(message_id, block_index));
            CREATE TABLE request_attempts(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES prompt_batches(id), thread_id TEXT NOT NULL REFERENCES model_threads(id), request_id TEXT NOT NULL, state TEXT NOT NULL, error_code TEXT, started_at TEXT NOT NULL, completed_at TEXT, usage_json TEXT);
            CREATE TABLE queued_prompts(id TEXT PRIMARY KEY, text TEXT NOT NULL, target_ids_json TEXT NOT NULL, attachments_json TEXT NOT NULL, position INTEGER NOT NULL, paused INTEGER NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE attachments(id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, byte_size INTEGER NOT NULL, width INTEGER, height INTEGER, relative_path TEXT NOT NULL, ref_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
            CREATE TABLE window_states(id TEXT PRIMARY KEY, bounds_json TEXT NOT NULL, work_area_json TEXT, monitor_id TEXT, scale_factor REAL, always_on_top INTEGER NOT NULL, locked INTEGER NOT NULL, background_opacity REAL NOT NULL, text_opacity REAL NOT NULL, updated_at TEXT NOT NULL);
            CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at);
            CREATE INDEX idx_threads_session ON model_threads(session_id);
            CREATE INDEX idx_attempts_batch ON request_attempts(batch_id);
            INSERT INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
            PRAGMA user_version = 1;
            "#,
        ).map_err(|error| format!("数据库迁移失败：{error}"))?;
        tx.commit()
            .map_err(|error| format!("数据库迁移提交失败：{error}"))
    }

    pub fn save_provider(
        &self,
        account: &ProviderAccount,
        profile: &ModelProfile,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let tx = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO provider_accounts(id,preset_id,alias,base_url,protocol,auth,secret_ref,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![account.id, account.preset_id, account.alias, account.base_url, account.protocol, account.auth, format!("provider/{}", account.id), now],
        ).map_err(|error| format!("保存供应商账号失败：{error}"))?;
        tx.execute(
            "INSERT INTO model_profiles(id,account_id,provider,provider_name,remote_model_id,display_name,color,enabled,capabilities_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            params![profile.id, profile.account_id, profile.provider, profile.provider_name, profile.remote_model_id, profile.display_name, profile.color, profile.enabled, profile.capabilities.to_string(), now],
        ).map_err(|error| format!("保存模型失败：{error}"))?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn update_provider(
        &self,
        account: &ProviderAccount,
        profile: &ModelProfile,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let tx = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let account_rows = tx.execute(
            "UPDATE provider_accounts SET alias=?2,base_url=?3,protocol=?4,auth=?5,updated_at=?6 WHERE id=?1",
            params![account.id, account.alias, account.base_url, account.protocol, account.auth, now],
        ).map_err(|error| format!("更新供应商账号失败：{error}"))?;
        let profile_rows = tx.execute(
            "UPDATE model_profiles SET display_name=?2,color=?3,enabled=?4,updated_at=?5 WHERE id=?1 AND account_id=?6",
            params![profile.id, profile.display_name, profile.color, profile.enabled, now, profile.account_id],
        ).map_err(|error| format!("更新模型失败：{error}"))?;
        if account_rows != 1 || profile_rows != 1 {
            return Err("模型配置不存在或已被删除".to_string());
        }
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn save_setting(&self, key: &str, value: &Value) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        connection.execute(
            "INSERT INTO app_settings(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
            params![key, value.to_string(), chrono::Utc::now().to_rfc3339()],
        ).map_err(|error| format!("保存本地设置失败：{error}"))?;
        Ok(())
    }

    pub fn merge_setting_object(&self, key: &str, patch: &Value) -> Result<Value, String> {
        let patch = patch
            .as_object()
            .ok_or_else(|| "配置快照必须是 JSON 对象".to_string())?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let existing = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key=?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
        let mut merged = existing
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        for (field, value) in patch {
            merged.insert(field.clone(), value.clone());
        }
        let merged = Value::Object(merged);
        connection.execute(
            "INSERT INTO app_settings(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
            params![key, merged.to_string(), chrono::Utc::now().to_rfc3339()],
        ).map_err(|error| format!("合并本地设置失败：{error}"))?;
        Ok(merged)
    }

    pub fn import_snapshot_and_configuration(
        &self,
        snapshot: &Value,
        accounts: &[ProviderAccount],
        profiles: &[ModelProfile],
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let tx = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for account in accounts {
            tx.execute(
                "INSERT INTO provider_accounts(id,preset_id,alias,base_url,protocol,auth,secret_ref,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET preset_id=excluded.preset_id,alias=excluded.alias,base_url=excluded.base_url,protocol=excluded.protocol,auth=excluded.auth,updated_at=excluded.updated_at",
                params![account.id, account.preset_id, account.alias, account.base_url, account.protocol, account.auth, format!("provider/{}", account.id), now],
            ).map_err(|error| format!("导入供应商配置失败：{error}"))?;
        }
        for profile in profiles {
            tx.execute(
                "INSERT INTO model_profiles(id,account_id,provider,provider_name,remote_model_id,display_name,color,enabled,capabilities_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,provider=excluded.provider,provider_name=excluded.provider_name,remote_model_id=excluded.remote_model_id,display_name=excluded.display_name,color=excluded.color,enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at",
                params![profile.id, profile.account_id, profile.provider, profile.provider_name, profile.remote_model_id, profile.display_name, profile.color, profile.enabled, profile.capabilities.to_string(), now],
            ).map_err(|error| format!("导入模型配置失败：{error}"))?;
        }
        tx.execute(
            "INSERT INTO app_settings(key,value_json,updated_at) VALUES('app_snapshot_v1',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
            params![snapshot.to_string(), now],
        ).map_err(|error| format!("导入应用数据失败：{error}"))?;
        tx.commit()
            .map_err(|error| format!("导入事务提交失败：{error}"))
    }

    pub fn save_attachment(
        &self,
        id: &str,
        mime: &str,
        byte_size: u64,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        connection.execute(
            "INSERT INTO attachments(id,sha256,mime,byte_size,width,height,relative_path,ref_count,created_at) VALUES(?1,?1,?2,?3,?4,?5,?1,1,?6) ON CONFLICT(sha256) DO UPDATE SET ref_count=attachments.ref_count+1",
            params![id, mime, byte_size as i64, width, height, chrono::Utc::now().to_rfc3339()],
        ).map_err(|error| format!("保存附件索引失败：{error}"))?;
        Ok(())
    }

    pub fn load_setting(&self, key: &str) -> Result<Option<Value>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let mut statement = connection
            .prepare("SELECT value_json FROM app_settings WHERE key=?1")
            .map_err(|error| error.to_string())?;
        let mut rows = statement
            .query(params![key])
            .map_err(|error| error.to_string())?;
        let Some(row) = rows.next().map_err(|error| error.to_string())? else {
            return Ok(None);
        };
        let raw: String = row.get(0).map_err(|error| error.to_string())?;
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "保存的应用快照无法解析".to_string())
    }

    pub fn clear_all(&self) -> Result<Vec<String>, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "数据库锁异常".to_string())?;
        let account_ids = {
            let mut statement = connection
                .prepare("SELECT id FROM provider_accounts")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        let tx = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        tx.execute_batch(
            r#"
            DELETE FROM message_content_blocks;
            DELETE FROM request_attempts;
            DELETE FROM messages;
            DELETE FROM prompt_batch_targets;
            DELETE FROM queued_prompts;
            DELETE FROM prompt_batches;
            DELETE FROM model_threads;
            DELETE FROM comparison_sessions;
            DELETE FROM pane_constraints;
            DELETE FROM layouts;
            DELETE FROM workspace_slots;
            DELETE FROM model_capabilities;
            DELETE FROM model_profiles;
            DELETE FROM provider_accounts;
            DELETE FROM attachments;
            DELETE FROM window_states;
            DELETE FROM app_settings;
            "#,
        )
        .map_err(|error| format!("清空数据库失败：{error}"))?;
        tx.commit().map_err(|error| error.to_string())?;
        let attachments = self.root.join("attachments");
        if attachments.exists() {
            for entry in fs::read_dir(&attachments).map_err(|error| error.to_string())? {
                let path = entry.map_err(|error| error.to_string())?.path();
                if path.is_file() {
                    fs::remove_file(path).map_err(|error| error.to_string())?;
                }
            }
        }
        Ok(account_ids)
    }
}
