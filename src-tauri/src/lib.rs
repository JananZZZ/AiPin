mod credentials;
mod db;
mod models;
mod network;
mod security;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use db::Database;
use image::GenericImageView;
use models::{
    AttachmentRef, IncomingAttachment, ModelProfile, ProviderAccount, StreamChatInput,
    StreamEnvelope,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_YESNO,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn fatal_dialog(message: &str) {
    if let Some(mut diagnostic_root) = dirs::data_local_dir() {
        diagnostic_root.push("AiPin");
        if fs::create_dir_all(&diagnostic_root).is_ok() {
            let _ = fs::write(diagnostic_root.join("last-startup-error.txt"), message);
        }
    }
    let title = wide("AiPin 启动失败");
    let body = wide(message);
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn confirm_exit_active() -> bool {
    let title = wide("退出 AiPin");
    let body = wide("当前仍有 AI 请求正在运行。是否取消这些请求并退出？");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONWARNING,
        ) == IDYES
    }
}

fn ensure_webview2_runtime() -> bool {
    match tauri::webview_version() {
        Ok(version) if !version.trim().is_empty() => true,
        Ok(_) | Err(_) => {
            let title = wide("AiPin 需要 WebView2");
            let body = wide(
                "这台电脑尚未安装 Microsoft Edge WebView2 Evergreen Runtime，AiPin 无法创建界面。\n\n是否打开微软官方下载页面？安装完成后请重新启动 AiPin。",
            );
            let open_download = unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    body.as_ptr(),
                    title.as_ptr(),
                    MB_YESNO | MB_ICONWARNING,
                ) == IDYES
            };
            if open_download {
                let _ = std::process::Command::new("rundll32.exe")
                    .args([
                        "url.dll,FileProtocolHandler",
                        "https://developer.microsoft.com/microsoft-edge/webview2/",
                    ])
                    .spawn();
            }
            false
        }
    }
}

struct AppState {
    db: Database,
    client: Client,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
    settings_route: Mutex<SettingsRoute>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsRoute {
    section: String,
    model_manager_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_profile_id: Option<String>,
}

impl Default for SettingsRoute {
    fn default() -> Self {
        Self {
            section: "models".into(),
            model_manager_mode: "list".into(),
            model_profile_id: None,
        }
    }
}

#[tauri::command]
fn save_provider_account(
    state: tauri::State<'_, AppState>,
    account: ProviderAccount,
    profile: ModelProfile,
    secret: String,
) -> Result<(), String> {
    security::validate_base_url(&account.base_url)?;
    if secret.trim().is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    credentials::save(&account.id, secret.trim())?;
    if let Err(error) = state.db.save_provider(&account, &profile) {
        let _ = credentials::delete(&account.id);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
fn update_provider_account(
    state: tauri::State<'_, AppState>,
    account: ProviderAccount,
    profile: ModelProfile,
    secret: Option<String>,
) -> Result<(), String> {
    security::validate_base_url(&account.base_url)?;
    if let Some(secret) = secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        credentials::save(&account.id, secret)?;
    }
    state.db.update_provider(&account, &profile)
}

#[tauri::command]
async fn test_provider(
    state: tauri::State<'_, AppState>,
    base_url: String,
    auth: String,
    secret: String,
) -> Result<String, String> {
    network::test_provider(&state.client, &base_url, &auth, &secret).await
}

#[tauri::command]
async fn stream_chat(
    state: tauri::State<'_, AppState>,
    input: StreamChatInput,
    on_event: Channel<StreamEnvelope>,
) -> Result<(), String> {
    let pane_id = input.pane_id.clone();
    let token = CancellationToken::new();
    state
        .cancellations
        .lock()
        .map_err(|_| "请求取消器锁异常".to_string())?
        .insert(pane_id.clone(), token.clone());
    let attachment_root = state.db.root.join("attachments");
    let result =
        network::stream_chat(&state.client, input, on_event, token, &attachment_root).await;
    state
        .cancellations
        .lock()
        .map_err(|_| "请求取消器锁异常".to_string())?
        .remove(&pane_id);
    result
}

#[tauri::command]
fn cancel_request(state: tauri::State<'_, AppState>, pane_id: String) -> Result<(), String> {
    if let Some(token) = state
        .cancellations
        .lock()
        .map_err(|_| "请求取消器锁异常".to_string())?
        .get(&pane_id)
    {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
fn stage_attachments(
    state: tauri::State<'_, AppState>,
    attachments: Vec<IncomingAttachment>,
) -> Result<Vec<AttachmentRef>, String> {
    if attachments.len() > 8 {
        return Err("每次最多添加 8 张图片".to_string());
    }
    attachments
        .into_iter()
        .map(|attachment| {
            let (width, height) = validate_attachment(&attachment)?;
            let id = format!("{:x}", Sha256::digest(&attachment.bytes));
            let target = state.db.root.join("attachments").join(&id);
            if !target.exists() {
                let temporary = state
                    .db
                    .root
                    .join("attachments")
                    .join(format!(".{id}-{}.tmp", uuid::Uuid::new_v4()));
                fs::write(&temporary, &attachment.bytes)
                    .map_err(|error| format!("附件临时写入失败：{error}"))?;
                if let Err(error) = fs::rename(&temporary, &target) {
                    if target.exists() {
                        let _ = fs::remove_file(&temporary);
                    } else {
                        return Err(format!("附件原子保存失败：{error}"));
                    }
                }
            }
            state.db.save_attachment(
                &id,
                &attachment.mime,
                attachment.bytes.len() as u64,
                width,
                height,
            )?;
            let safe_name: String = attachment
                .name
                .chars()
                .filter(|character| !character.is_control())
                .take(160)
                .collect();
            Ok(AttachmentRef {
                id,
                name: if safe_name.is_empty() {
                    "image".into()
                } else {
                    safe_name
                },
                mime: attachment.mime,
                byte_size: attachment.bytes.len() as u64,
            })
        })
        .collect()
}

fn validate_attachment(attachment: &IncomingAttachment) -> Result<(u32, u32), String> {
    if attachment.bytes.is_empty() || attachment.bytes.len() > 20 * 1024 * 1024 {
        return Err("单张图片必须小于 20MiB".to_string());
    }
    let expected = match attachment.mime.as_str() {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("仅支持 PNG、JPEG 和 WebP 图片".to_string()),
    };
    let detected =
        image::guess_format(&attachment.bytes).map_err(|_| "无法识别图片文件签名".to_string())?;
    if detected != expected {
        return Err("图片扩展类型与文件内容不一致".to_string());
    }
    let decoded = image::load_from_memory_with_format(&attachment.bytes, expected)
        .map_err(|_| "图片已损坏或无法解码".to_string())?;
    let (width, height) = decoded.dimensions();
    if u64::from(width) * u64::from(height) > 32_000_000 {
        return Err("单张图片不能超过约 32MP".to_string());
    }
    Ok((width, height))
}

#[tauri::command]
fn get_attachment_data_url(
    state: tauri::State<'_, AppState>,
    attachment_id: String,
) -> Result<String, String> {
    if attachment_id.len() != 64
        || !attachment_id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("附件标识无效".to_string());
    }
    let bytes = fs::read(state.db.root.join("attachments").join(&attachment_id))
        .map_err(|_| "附件不存在或已被清理".to_string())?;
    let mime = match image::guess_format(&bytes).map_err(|_| "附件格式无效".to_string())? {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("附件格式不受支持".to_string()),
    };
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

#[tauri::command]
fn save_app_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    snapshot: Value,
    sync_snapshot: Value,
    broadcast: bool,
    configuration_only: bool,
) -> Result<(), String> {
    if configuration_only {
        state
            .db
            .merge_setting_object("app_snapshot_v1", &sync_snapshot)?;
    } else {
        state.db.save_setting("app_snapshot_v1", &snapshot)?;
    }
    if broadcast {
        app.emit("app-snapshot-updated", sync_snapshot)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn load_app_snapshot(state: tauri::State<'_, AppState>) -> Result<Option<Value>, String> {
    state.db.load_setting("app_snapshot_v1")
}

const SYNC_SNAPSHOT_FIELDS: [&str; 14] = [
    "accounts",
    "profiles",
    "columns",
    "rows",
    "columnWeights",
    "rowWeights",
    "autoLayout",
    "composerSize",
    "selectedTargets",
    "onboardingVisible",
    "promptTemplates",
    "sessionHistory",
    "settings",
    "workspaceSlots",
];

fn project_sync_snapshot(snapshot: Value) -> Value {
    let Some(source) = snapshot.as_object() else {
        return serde_json::json!({});
    };
    let mut projected = serde_json::Map::new();
    for field in SYNC_SNAPSHOT_FIELDS {
        if let Some(value) = source.get(field) {
            projected.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(projected)
}

#[tauri::command]
fn load_app_sync_snapshot(state: tauri::State<'_, AppState>) -> Result<Option<Value>, String> {
    state
        .db
        .load_setting("app_snapshot_v1")
        .map(|snapshot| snapshot.map(project_sync_snapshot))
}

#[tauri::command]
fn export_diagnostics(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let path = state.db.root.join(format!(
        "aipin-diagnostic-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let document = serde_json::json!({
        "application": "AiPin",
        "version": env!("CARGO_PKG_VERSION"),
        "schemaVersion": 1,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "platform": "windows-x64",
        "privacy": "No credentials, prompts, responses, attachments, URLs, usernames, or source paths are included."
    });
    fs::write(
        &path,
        serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("诊断文件写入失败：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}

const PORTABLE_CONFIGURATION_FIELDS: [&str; 12] = [
    "accounts",
    "profiles",
    "columns",
    "rows",
    "columnWeights",
    "rowWeights",
    "autoLayout",
    "composerSize",
    "selectedTargets",
    "onboardingVisible",
    "promptTemplates",
    "settings",
];
const PORTABLE_DATA_FIELDS: [&str; 5] = [
    "threads",
    "promptHistory",
    "queue",
    "sessionHistory",
    "composerText",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableAttachment {
    id: String,
    mime: String,
    byte_size: u64,
    data_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortablePackage {
    format: String,
    schema_version: u32,
    application_version: String,
    created_at: String,
    scope: String,
    #[serde(default)]
    configuration: Option<Value>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    attachments: Vec<PortableAttachment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableTransferResult {
    path: Option<String>,
    scope: String,
    profile_count: usize,
    session_count: usize,
    attachment_count: usize,
    imported_at: Option<String>,
}

fn portable_scope(scope: &str) -> Result<&str, String> {
    match scope {
        "configuration" | "data" | "all" => Ok(scope),
        _ => Err("未知的导入导出范围".to_string()),
    }
}

fn project_fields(snapshot: &Value, fields: &[&str]) -> Value {
    let mut result = serde_json::Map::new();
    if let Some(source) = snapshot.as_object() {
        for field in fields {
            if let Some(value) = source.get(*field) {
                result.insert((*field).to_string(), value.clone());
            }
        }
    }
    Value::Object(result)
}

fn sanitize_portable_configuration(mut configuration: Value) -> Value {
    if let Some(accounts) = configuration
        .get_mut("accounts")
        .and_then(Value::as_array_mut)
    {
        for account in accounts {
            if let Some(account) = account.as_object_mut() {
                account.insert("secretConfigured".to_string(), Value::Bool(false));
                account.remove("secretRef");
            }
        }
    }
    configuration
}

#[tauri::command]
fn export_portable_data(
    state: tauri::State<'_, AppState>,
    scope: String,
) -> Result<PortableTransferResult, String> {
    let scope = portable_scope(&scope)?;
    let snapshot = state
        .db
        .load_setting("app_snapshot_v1")?
        .unwrap_or_else(|| serde_json::json!({}));
    let configuration = (scope != "data").then(|| {
        sanitize_portable_configuration(project_fields(&snapshot, &PORTABLE_CONFIGURATION_FIELDS))
    });
    let data = (scope != "configuration").then(|| project_fields(&snapshot, &PORTABLE_DATA_FIELDS));
    let mut attachments = Vec::new();
    if scope != "configuration" {
        let attachment_root = state.db.root.join("attachments");
        for entry in fs::read_dir(&attachment_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let id = entry.file_name().to_string_lossy().to_string();
            if !path.is_file()
                || id.len() != 64
                || !id.chars().all(|character| character.is_ascii_hexdigit())
            {
                continue;
            }
            let bytes = fs::read(&path).map_err(|error| format!("读取附件失败：{error}"))?;
            let mime = image::guess_format(&bytes)
                .ok()
                .map(|format| match format {
                    image::ImageFormat::Png => "image/png",
                    image::ImageFormat::Jpeg => "image/jpeg",
                    image::ImageFormat::WebP => "image/webp",
                    _ => "application/octet-stream",
                })
                .unwrap_or("application/octet-stream")
                .to_string();
            attachments.push(PortableAttachment {
                id,
                mime,
                byte_size: bytes.len() as u64,
                data_base64: BASE64.encode(bytes),
            });
        }
    }
    let profile_count = configuration
        .as_ref()
        .and_then(|value| value.get("profiles"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let session_count = data
        .as_ref()
        .and_then(|value| value.get("sessionHistory"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let attachment_count = attachments.len();
    let document = PortablePackage {
        format: "com.aipin.portable".to_string(),
        schema_version: 1,
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        scope: scope.to_string(),
        configuration,
        data,
        attachments,
    };
    let export_root = state.db.root.join("exports");
    fs::create_dir_all(&export_root).map_err(|error| format!("无法创建导出目录：{error}"))?;
    let file_name = format!(
        "AiPin-{}-{}.aipin",
        scope,
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    let path = export_root.join(file_name);
    let temporary = path.with_extension("aipin.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&document).map_err(|error| format!("导出包编码失败：{error}"))?,
    )
    .map_err(|error| format!("导出文件写入失败：{error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("导出文件提交失败：{error}"))?;
    Ok(PortableTransferResult {
        path: Some(path.to_string_lossy().to_string()),
        scope: scope.to_string(),
        profile_count,
        session_count,
        attachment_count,
        imported_at: None,
    })
}

fn merge_portable_fields(
    target: &mut serde_json::Map<String, Value>,
    source: &Value,
    fields: &[&str],
) {
    if let Some(source) = source.as_object() {
        for field in fields {
            if let Some(value) = source.get(*field) {
                target.insert((*field).to_string(), value.clone());
            }
        }
    }
}

#[tauri::command]
fn import_portable_data(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    bytes: Vec<u8>,
    scope: String,
) -> Result<PortableTransferResult, String> {
    let scope = portable_scope(&scope)?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("导入文件超过 256MiB 安全上限".to_string());
    }
    let package: PortablePackage =
        serde_json::from_slice(&bytes).map_err(|_| "这不是有效的 AiPin 数据文件".to_string())?;
    if package.format != "com.aipin.portable" || package.schema_version != 1 {
        return Err("AiPin 数据文件版本不受支持".to_string());
    }
    portable_scope(&package.scope)?;
    if scope != "data" && package.configuration.is_none() {
        return Err("该文件不包含软件配置".to_string());
    }
    if scope != "configuration" && package.data.is_none() {
        return Err("该文件不包含会话数据".to_string());
    }
    let existing = state
        .db
        .load_setting("app_snapshot_v1")?
        .unwrap_or_else(|| serde_json::json!({}));
    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if scope != "data" {
        let configuration = sanitize_portable_configuration(package.configuration.clone().unwrap());
        merge_portable_fields(&mut merged, &configuration, &PORTABLE_CONFIGURATION_FIELDS);
        if let Some(profiles) = merged.get_mut("profiles").and_then(Value::as_array_mut) {
            let mut active = 0usize;
            for profile in profiles {
                if let Some(profile) = profile.as_object_mut() {
                    let enabled = profile
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    let allowed = enabled && active < 17;
                    profile.insert("enabled".to_string(), Value::Bool(allowed));
                    if allowed {
                        active += 1;
                    }
                }
            }
        }
        let active_ids = merged
            .get("profiles")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|profile| profile.get("enabled").and_then(Value::as_bool) != Some(false))
            .filter_map(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<std::collections::HashSet<_>>();
        if let Some(targets) = merged
            .get_mut("selectedTargets")
            .and_then(Value::as_array_mut)
        {
            targets.retain(|id| id.as_str().is_some_and(|id| active_ids.contains(id)));
        }
    }
    if scope != "configuration" {
        merge_portable_fields(
            &mut merged,
            package.data.as_ref().unwrap(),
            &PORTABLE_DATA_FIELDS,
        );
        if let Some(queue) = merged.get_mut("queue").and_then(Value::as_array_mut) {
            for item in queue {
                if let Some(item) = item.as_object_mut() {
                    item.insert("paused".to_string(), Value::Bool(true));
                }
            }
        }
    }
    let snapshot = Value::Object(merged);
    let mut staged = Vec::new();
    if scope != "configuration" {
        let attachment_root = state.db.root.join("attachments");
        for attachment in &package.attachments {
            if attachment.id.len() != 64
                || !attachment
                    .id
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
                || attachment.byte_size > 20 * 1024 * 1024
                || !matches!(
                    attachment.mime.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                )
            {
                return Err("导入包包含非法附件元数据".to_string());
            }
            let decoded = BASE64
                .decode(&attachment.data_base64)
                .map_err(|_| "导入包中的附件无法解码".to_string())?;
            if decoded.len() as u64 != attachment.byte_size
                || format!("{:x}", Sha256::digest(&decoded)) != attachment.id.to_ascii_lowercase()
            {
                return Err("导入包中的附件校验失败".to_string());
            }
            let target = attachment_root.join(&attachment.id);
            if !target.exists() {
                let temporary = attachment_root.join(format!("{}.import.tmp", attachment.id));
                fs::write(&temporary, decoded)
                    .map_err(|error| format!("暂存导入附件失败：{error}"))?;
                staged.push((temporary, target));
            }
        }
    }
    let backup_root = state.db.root.join("backups");
    let backup_path = backup_root.join(format!(
        "pre-import-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    fs::write(
        &backup_path,
        serde_json::to_vec(&existing).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("导入前备份失败：{error}"))?;
    let accounts = snapshot
        .get("accounts")
        .cloned()
        .map(serde_json::from_value::<Vec<ProviderAccount>>)
        .transpose()
        .map_err(|error| format!("供应商配置校验失败：{error}"))?
        .unwrap_or_default();
    let profiles = snapshot
        .get("profiles")
        .cloned()
        .map(serde_json::from_value::<Vec<ModelProfile>>)
        .transpose()
        .map_err(|error| format!("模型配置校验失败：{error}"))?
        .unwrap_or_default();
    state
        .db
        .import_snapshot_and_configuration(&snapshot, &accounts, &profiles)?;
    if scope != "data" {
        for account in &accounts {
            let _ = credentials::delete(&account.id);
        }
    }
    for (temporary, target) in staged {
        fs::rename(&temporary, &target).map_err(|error| format!("提交导入附件失败：{error}"))?;
    }
    app.emit("app-snapshot-updated", snapshot.clone())
        .map_err(|error| error.to_string())?;
    let session_count = snapshot
        .get("sessionHistory")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Ok(PortableTransferResult {
        path: None,
        scope: scope.to_string(),
        profile_count: profiles.len(),
        session_count,
        attachment_count: package.attachments.len(),
        imported_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

#[tauri::command]
fn clear_all_data(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let account_ids = state.db.clear_all()?;
    for account_id in account_ids {
        let _ = credentials::delete(&account_id);
    }
    Ok(())
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?
        .hide()
        .map_err(|error| error.to_string())
}

fn show_settings(app: &tauri::AppHandle, mut route: SettingsRoute) -> Result<(), String> {
    route.section = match route.section.as_str() {
        "models" | "appearance" | "layout" | "conversation" | "history" | "prompts" | "privacy"
        | "shortcuts" | "about" => route.section.clone(),
        _ => "models".to_string(),
    };
    if route.model_manager_mode != "add" && route.model_manager_mode != "edit" {
        route.model_manager_mode = "list".to_string();
    }
    if route.model_manager_mode != "edit"
        || route.model_profile_id.as_ref().is_some_and(|id| {
            id.len() > 160
                || !id
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "_-".contains(character))
        })
    {
        route.model_profile_id = None;
        if route.model_manager_mode == "edit" {
            route.model_manager_mode = "list".to_string();
        }
    }
    *app.state::<AppState>()
        .settings_route
        .lock()
        .map_err(|_| "设置页状态锁异常".to_string())? = route.clone();
    let existing = app.get_webview_window("settings");
    let (window, created) = if let Some(window) = existing {
        window
            .show()
            .map_err(|error| format!("无法显示设置窗口：{error}"))?;
        (window, false)
    } else {
        let settings_config = app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "settings")
            .cloned()
            .ok_or_else(|| "设置窗口配置不存在".to_string())?;
        let window = WebviewWindowBuilder::from_config(app, &settings_config)
            .map_err(|error| format!("设置窗口配置无效：{error}"))?
            .build()
            .map_err(|error| format!("无法创建设置窗口：{error}"))?;
        (window, true)
    };
    window
        .set_always_on_top(false)
        .map_err(|error| format!("无法同步设置窗口层级：{error}"))?;
    window
        .center()
        .map_err(|error| format!("无法定位设置窗口：{error}"))?;
    let _ = window.set_skip_taskbar(false);
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|error| format!("设置窗口已创建但无法显示：{error}"))?;
    if !created {
        app.emit_to("settings", "open-settings-section", route)
            .map_err(|error| format!("无法切换设置分类：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_settings_window(
    app: tauri::AppHandle,
    section: String,
    model_manager_mode: Option<String>,
    model_profile_id: Option<String>,
) -> Result<(), String> {
    show_settings(
        &app,
        SettingsRoute {
            section,
            model_manager_mode: model_manager_mode.unwrap_or_else(|| "list".into()),
            model_profile_id,
        },
    )
}

#[tauri::command]
fn hide_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "设置窗口不存在".to_string())?;
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_window_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SettingsRoute, String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "设置窗口不存在".to_string())?;
    let (target_width, target_height, min_width, min_height) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let logical_width = monitor.size().width as f64 / scale;
            let logical_height = monitor.size().height as f64 / scale;
            let safe_width = (logical_width - 48.0).max(280.0);
            let safe_height = (logical_height - 80.0).max(240.0);
            let target_width = 900.0_f64.min(safe_width);
            let target_height = 680.0_f64.min(safe_height);
            (
                target_width,
                target_height,
                720.0_f64.min(target_width),
                520.0_f64.min(target_height),
            )
        })
        .unwrap_or((900.0, 680.0, 720.0, 520.0));
    // Lower the configured bootstrap minimum before resizing so the settings
    // window remains usable on compact displays and remote-desktop sessions.
    window
        .set_min_size(Some(tauri::LogicalSize::new(min_width, min_height)))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(target_width, target_height))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_focus();
    state
        .settings_route
        .lock()
        .map(|route| route.clone())
        .map_err(|_| "设置页状态锁异常".to_string())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !ensure_webview2_runtime() {
        return;
    }
    #[cfg(debug_assertions)]
    eprintln!("aipin: opening database");
    let database = match Database::open() {
        Ok(database) => database,
        Err(error) => {
            fatal_dialog(&error);
            return;
        }
    };
    let client = match network::build_client() {
        Ok(client) => client,
        Err(error) => {
            fatal_dialog(&error);
            return;
        }
    };
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let webview_root = database.root.join("webview2");
        if let Err(error) = fs::create_dir_all(&webview_root) {
            fatal_dialog(&format!("无法创建 WebView2 数据目录：{error}"));
            return;
        }
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_root);
    }
    #[cfg(debug_assertions)]
    eprintln!("aipin: building runtime");
    let result = tauri::Builder::default()
        .manage(AppState {
            db: database,
            client,
            cancellations: Mutex::new(HashMap::new()),
            settings_route: Mutex::new(SettingsRoute::default()),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_main(app);
                        let _ = app.emit_to("main", "emergency-visibility-reset", ());
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            #[cfg(debug_assertions)]
            eprintln!("aipin: setup entered");
            let show = MenuItem::with_id(app, "show", "显示 AiPin", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &quit])?;
            let mut tray = TrayIconBuilder::with_id("aipin-tray")
                .menu(&menu)
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main(app),
                "settings" => {
                    let _ = show_settings(app, SettingsRoute::default());
                }
                "quit" => {
                    let state = app.state::<AppState>();
                    let active = state
                        .cancellations
                        .lock()
                        .map(|requests| !requests.is_empty())
                        .unwrap_or(true);
                    if !active || confirm_exit_active() {
                        if let Ok(requests) = state.cancellations.lock() {
                            for token in requests.values() {
                                token.cancel();
                            }
                        }
                        app.exit(0);
                    }
                }
                _ => {}
            })
            .build(app)?;

            #[cfg(debug_assertions)]
            eprintln!("aipin: tray ready");

            let _ = app.global_shortcut().register("Ctrl+Alt+Space");
            #[cfg(debug_assertions)]
            eprintln!("aipin: shortcut ready");
            if let Some(main_window) = app.get_webview_window("main") {
                let close_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(window) = close_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
            }
            #[cfg(debug_assertions)]
            eprintln!("aipin: setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_provider_account,
            update_provider_account,
            test_provider,
            stream_chat,
            cancel_request,
            stage_attachments,
            get_attachment_data_url,
            save_app_snapshot,
            load_app_snapshot,
            load_app_sync_snapshot,
            export_diagnostics,
            export_portable_data,
            import_portable_data,
            clear_all_data,
            hide_main_window,
            open_settings_window,
            hide_settings_window,
            settings_window_ready
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        fatal_dialog(&format!("Windows 窗口或 WebView2 初始化失败：{error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_validation_checks_signature_and_decode() {
        let png = BASE64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=").expect("fixture");
        let valid = IncomingAttachment {
            name: "pixel.png".into(),
            mime: "image/png".into(),
            bytes: png.clone(),
        };
        assert_eq!(validate_attachment(&valid).expect("valid png"), (1, 1));
        let mismatch = IncomingAttachment {
            name: "pixel.jpg".into(),
            mime: "image/jpeg".into(),
            bytes: png,
        };
        assert_eq!(
            validate_attachment(&mismatch).expect_err("mismatch"),
            "图片扩展类型与文件内容不一致"
        );
    }

    #[test]
    fn attachment_validation_rejects_unknown_or_empty_files() {
        let unknown = IncomingAttachment {
            name: "file.gif".into(),
            mime: "image/gif".into(),
            bytes: vec![1, 2, 3],
        };
        assert_eq!(
            validate_attachment(&unknown).expect_err("unsupported"),
            "仅支持 PNG、JPEG 和 WebP 图片"
        );
        let empty = IncomingAttachment {
            name: "empty.png".into(),
            mime: "image/png".into(),
            bytes: vec![],
        };
        assert_eq!(
            validate_attachment(&empty).expect_err("empty"),
            "单张图片必须小于 20MiB"
        );
    }

    #[test]
    fn portable_configuration_never_exports_key_state() {
        let snapshot = serde_json::json!({
            "accounts": [{
                "id": "account-1",
                "secretConfigured": true,
                "secretRef": "provider/account-1"
            }],
            "profiles": [{ "id": "profile-1" }],
            "threads": { "profile-1": { "messages": ["private"] } }
        });
        let projected = sanitize_portable_configuration(project_fields(
            &snapshot,
            &PORTABLE_CONFIGURATION_FIELDS,
        ));
        assert_eq!(projected["accounts"][0]["secretConfigured"], false);
        assert!(projected["accounts"][0].get("secretRef").is_none());
        assert!(projected.get("threads").is_none());
    }

    #[test]
    fn portable_scopes_are_strict() {
        assert_eq!(portable_scope("configuration").unwrap(), "configuration");
        assert_eq!(portable_scope("data").unwrap(), "data");
        assert_eq!(portable_scope("all").unwrap(), "all");
        assert!(portable_scope("credentials").is_err());
    }
}
