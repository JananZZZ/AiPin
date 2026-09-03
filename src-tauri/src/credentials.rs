const SERVICE: &str = "AiPin";

fn entry(account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("provider/{account_id}"))
        .map_err(|_| "无法访问 Windows Credential Manager".to_string())
}

pub fn save(account_id: &str, secret: &str) -> Result<(), String> {
    entry(account_id)?
        .set_password(secret)
        .map_err(|_| "API Key 写入 Windows Credential Manager 失败".to_string())
}

pub fn read(account_id: &str) -> Result<String, String> {
    entry(account_id)?
        .get_password()
        .map_err(|_| "未找到该账号的 API Key，请在设置中重新配置".to_string())
}

#[allow(dead_code)]
pub fn delete(account_id: &str) -> Result<(), String> {
    entry(account_id)?
        .delete_credential()
        .map_err(|_| "清除保存的 API Key 失败".to_string())
}
