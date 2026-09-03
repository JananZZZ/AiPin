use url::Url;

pub fn validate_base_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Base URL 格式无效".to_string())?;
    let host = url.host_str().unwrap_or_default();
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("远程供应商必须使用 HTTPS；HTTP 只允许本机回环地址".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Base URL 不能包含用户名或密码".to_string());
    }
    Ok(url)
}

pub fn endpoint(base: &Url, path: &str) -> Result<Url, String> {
    let mut url = base.clone();
    let current = url.path().trim_end_matches('/');
    let suffix = path.trim_start_matches('/');
    url.set_path(&format!("{current}/{suffix}"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

pub fn sanitize_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        400 => "请求参数被供应商拒绝".into(),
        401 => "认证失败，请替换 API Key 后重试".into(),
        403 => "权限不足，账号无权访问该模型".into(),
        404 => "模型或接口不存在，请检查模型 ID 与 Base URL".into(),
        408 => "供应商请求超时".into(),
        413 => "输入或图片超过供应商限制".into(),
        429 => "请求被限流或账户配额不足".into(),
        500..=599 => format!("供应商服务异常（HTTP {}）", status.as_u16()),
        _ => format!("供应商返回 HTTP {}", status.as_u16()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_insecure_remote_and_embedded_credentials() {
        assert!(validate_base_url("http://example.com/v1").is_err());
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
    }

    #[test]
    fn endpoint_preserves_base_path_and_removes_query() {
        let base = validate_base_url("https://example.com/api/v1?token=hidden").expect("base");
        let result = endpoint(&base, "chat/completions").expect("endpoint");
        assert_eq!(
            result.as_str(),
            "https://example.com/api/v1/chat/completions"
        );
    }
}
