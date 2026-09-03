use crate::{
    credentials,
    models::{StreamChatInput, StreamEnvelope},
    security,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION},
    Client,
};
use serde_json::{json, Value};
use std::{fs, path::Path, time::Duration};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

fn auth_headers(auth: &str, secret: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    let value = if auth == "api-key" {
        HeaderValue::from_str(secret).map_err(|_| "API Key 包含无效字符".to_string())?
    } else {
        HeaderValue::from_str(&format!("Bearer {secret}"))
            .map_err(|_| "API Key 包含无效字符".to_string())?
    };
    if auth == "api-key" {
        headers.insert("api-key", value);
    } else {
        headers.insert(AUTHORIZATION, value);
    }
    Ok(headers)
}

pub fn build_client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(30))
        .user_agent("AiPin/0.1")
        .build()
        .map_err(|error| format!("网络客户端初始化失败：{error}"))
}

fn body_for(input: &StreamChatInput, attachment_root: &Path) -> Result<Value, String> {
    let messages: Vec<Value> = input
        .messages
        .iter()
        .map(|message| {
            if message.attachments.is_empty() {
                let mut value = json!({"role": message.role, "content": message.content});
                if input.protocol != "responses" {
                    if let Some(reasoning) = message
                        .reasoning_content
                        .as_ref()
                        .filter(|value| !value.is_empty())
                    {
                        value["reasoning_content"] = json!(reasoning);
                    }
                }
                return Ok(value);
            }
            let mut content = vec![if input.protocol == "responses" {
                json!({"type": "input_text", "text": message.content})
            } else {
                json!({"type": "text", "text": message.content})
            }];
            for attachment in &message.attachments {
                if attachment.id.len() != 64
                    || !attachment
                        .id
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
                {
                    return Err("附件标识无效".to_string());
                }
                let bytes = fs::read(attachment_root.join(&attachment.id))
                    .map_err(|_| format!("附件无法读取：{}", attachment.name))?;
                if bytes.len() > 20 * 1024 * 1024 {
                    return Err("附件超过 20MiB 限制".to_string());
                }
                let data_url = format!("data:{};base64,{}", attachment.mime, BASE64.encode(bytes));
                content.push(if input.protocol == "responses" {
                    json!({"type": "input_image", "image_url": data_url})
                } else {
                    json!({"type": "image_url", "image_url": {"url": data_url}})
                });
            }
            Ok(json!({"role": message.role, "content": content}))
        })
        .collect::<Result<_, String>>()?;
    if input.protocol == "responses" {
        let mut body =
            json!({ "model": input.model, "input": messages, "stream": true, "store": false });
        if input.reasoning_enabled {
            body["reasoning"] = json!({ "effort": input.reasoning_effort });
        }
        if parameter_bool(&input.parameters, "webSearchEnabled") {
            body["tools"] = json!([{ "type": "web_search" }]);
            body["include"] = json!(["web_search_call.action.sources"]);
        }
        apply_number(
            &mut body,
            &input.parameters,
            "maxOutputTokens",
            "max_output_tokens",
            1.0,
            1_048_576.0,
        )?;
        apply_number(
            &mut body,
            &input.parameters,
            "temperature",
            "temperature",
            0.0,
            2.0,
        )?;
        apply_number(&mut body, &input.parameters, "topP", "top_p", 0.0, 1.0)?;
        Ok(body)
    } else {
        let mut body = json!({ "model": input.model, "messages": messages, "stream": true });
        let mode = parameter_string(&input.parameters, "thinkingMode");
        let effort = parameter_string(&input.parameters, "reasoningEffort");
        match input.provider.as_str() {
            "deepseek" => {
                if matches!(mode, Some("enabled") | Some("disabled")) {
                    body["thinking"] = json!({ "type": mode.unwrap() });
                }
                if mode != Some("disabled") {
                    if let Some(value @ ("low" | "high" | "max")) = effort {
                        body["reasoning_effort"] = json!(value);
                    }
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "maxOutputTokens",
                    "max_tokens",
                    1.0,
                    1_048_576.0,
                )?;
            }
            "minimax" => {
                if mode == Some("adaptive") {
                    body["thinking"] = json!({ "type": "adaptive" });
                }
                if let Some(value) = input
                    .parameters
                    .get("reasoningSplit")
                    .and_then(Value::as_bool)
                {
                    body["reasoning_split"] = json!(value);
                }
                if let Some(value @ ("standard" | "priority")) =
                    parameter_string(&input.parameters, "serviceTier")
                {
                    body["service_tier"] = json!(value);
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "maxOutputTokens",
                    "max_completion_tokens",
                    1.0,
                    if input.model.to_ascii_lowercase().starts_with("minimax-m3") {
                        524_288.0
                    } else {
                        204_800.0
                    },
                )?;
                apply_number(
                    &mut body,
                    &input.parameters,
                    "temperature",
                    "temperature",
                    0.0,
                    2.0,
                )?;
                apply_number(&mut body, &input.parameters, "topP", "top_p", 0.0, 1.0)?;
            }
            "kimi" => {
                let model = input.model.to_ascii_lowercase();
                if model.starts_with("kimi-k3") {
                    if let Some(value @ ("low" | "high" | "max")) = effort {
                        body["reasoning_effort"] = json!(value);
                    }
                } else if model.starts_with("kimi-k2.6") {
                    let keep = parameter_string(&input.parameters, "thinkingKeep");
                    let mut thinking = serde_json::Map::new();
                    if matches!(mode, Some("enabled") | Some("disabled")) {
                        thinking.insert("type".into(), json!(mode.unwrap()));
                    }
                    if keep == Some("all") {
                        thinking.insert("keep".into(), json!("all"));
                    } else if keep == Some("none") {
                        thinking.insert("keep".into(), Value::Null);
                    }
                    if !thinking.is_empty() {
                        body["thinking"] = Value::Object(thinking);
                    }
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "maxOutputTokens",
                    "max_tokens",
                    1.0,
                    1_048_576.0,
                )?;
                if parameter_bool(&input.parameters, "webSearchEnabled") {
                    body["thinking"] = json!({ "type": "disabled" });
                    body["tools"] = json!([{ "type": "builtin_function", "function": { "name": "$web_search" } }]);
                }
            }
            "siliconflow" => {
                if matches!(mode, Some("enabled") | Some("disabled")) {
                    body["enable_thinking"] = json!(mode == Some("enabled"));
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "thinkingBudget",
                    "thinking_budget",
                    128.0,
                    32_768.0,
                )?;
                if let Some(value @ ("high" | "max")) = effort {
                    body["reasoning_effort"] = json!(value);
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "maxOutputTokens",
                    "max_tokens",
                    1.0,
                    1_048_576.0,
                )?;
                apply_number(
                    &mut body,
                    &input.parameters,
                    "temperature",
                    "temperature",
                    0.0,
                    2.0,
                )?;
                apply_number(&mut body, &input.parameters, "topP", "top_p", 0.0, 1.0)?;
                apply_number(&mut body, &input.parameters, "topK", "top_k", 0.0, 100.0)?;
                apply_number(&mut body, &input.parameters, "minP", "min_p", 0.0, 1.0)?;
                apply_number(
                    &mut body,
                    &input.parameters,
                    "frequencyPenalty",
                    "frequency_penalty",
                    -2.0,
                    2.0,
                )?;
            }
            "glm" | "mimo" | "custom" => {
                if input.reasoning_enabled {
                    body["reasoning_effort"] = json!(input.reasoning_effort);
                }
                apply_number(
                    &mut body,
                    &input.parameters,
                    "maxOutputTokens",
                    "max_tokens",
                    1.0,
                    1_048_576.0,
                )?;
                apply_number(
                    &mut body,
                    &input.parameters,
                    "temperature",
                    "temperature",
                    0.0,
                    2.0,
                )?;
                apply_number(&mut body, &input.parameters, "topP", "top_p", 0.0, 1.0)?;
                if parameter_bool(&input.parameters, "webSearchEnabled") {
                    if input.provider == "glm" {
                        body["tools"] = json!([{ "type": "web_search", "web_search": { "enable": true, "search_engine": "search_std", "search_result": true } }]);
                        body["tool_choice"] = json!("auto");
                    } else if input.provider == "mimo" {
                        body["tools"] = json!([{ "type": "web_search", "max_keyword": 3, "force_search": false, "limit": 3 }]);
                    }
                }
            }
            _ => {}
        }
        Ok(body)
    }
}

fn parameter_string<'a>(parameters: &'a Value, name: &str) -> Option<&'a str> {
    parameters.get(name).and_then(Value::as_str)
}

fn parameter_bool(parameters: &Value, name: &str) -> bool {
    parameters
        .get(name)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn apply_number(
    body: &mut Value,
    parameters: &Value,
    source: &str,
    target: &str,
    min: f64,
    max: f64,
) -> Result<(), String> {
    let Some(value) = parameters.get(source) else {
        return Ok(());
    };
    let number = value
        .as_f64()
        .filter(|number| number.is_finite() && *number >= min && *number <= max)
        .ok_or_else(|| format!("模型参数 {source} 超出允许范围"))?;
    body[target] = if value.is_u64() || value.is_i64() {
        value.clone()
    } else {
        json!(number)
    };
    Ok(())
}

fn send_event(
    channel: &Channel<StreamEnvelope>,
    input: &StreamChatInput,
    request_id: &str,
    attempt_id: &str,
    sequence: &mut u64,
    kind: &str,
    payload: Value,
) -> Result<(), String> {
    let event = StreamEnvelope::new(input, request_id, attempt_id, *sequence, kind, payload);
    *sequence += 1;
    channel
        .send(event)
        .map_err(|_| "前端流式通道已关闭".to_string())
}

pub async fn test_provider(
    client: &Client,
    base_url: &str,
    auth: &str,
    secret: &str,
) -> Result<String, String> {
    let base = security::validate_base_url(base_url)?;
    let url = security::endpoint(&base, "models")?;
    let response = client
        .get(url)
        .headers(auth_headers(auth, secret)?)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "网络连接失败或超时".to_string())?;
    if !response.status().is_success() {
        return Err(security::sanitize_error(response.status()));
    }
    Ok("认证成功；模型列表接口可访问，未产生文本生成费用。".to_string())
}

pub async fn stream_chat(
    client: &Client,
    input: StreamChatInput,
    channel: Channel<StreamEnvelope>,
    cancel: CancellationToken,
    attachment_root: &Path,
) -> Result<(), String> {
    let base = security::validate_base_url(&input.base_url)?;
    let path = if input.protocol == "responses" {
        "responses"
    } else {
        "chat/completions"
    };
    let url = security::endpoint(&base, path)?;
    let secret = credentials::read(&input.account_id)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let mut sequence = 0;
    send_event(
        &channel,
        &input,
        &request_id,
        &attempt_id,
        &mut sequence,
        "started",
        json!({}),
    )?;

    let mut body = body_for(&input, attachment_root)?;
    if input.provider == "kimi" && parameter_bool(&input.parameters, "webSearchEnabled") {
        body["stream"] = json!(false);
        let search_response = client
            .post(url.clone())
            .headers(auth_headers(&input.auth, &secret)?)
            .json(&body)
            .send()
            .await
            .map_err(|_| "Kimi 联网搜索连接失败或 TLS 握手超时".to_string())?;
        if !search_response.status().is_success() {
            let message = security::sanitize_error(search_response.status());
            send_event(
                &channel,
                &input,
                &request_id,
                &attempt_id,
                &mut sequence,
                "failed",
                json!({"message": message}),
            )?;
            return Ok(());
        }
        let search_value: Value = search_response
            .json()
            .await
            .map_err(|_| "Kimi 联网搜索响应格式无效".to_string())?;
        let assistant = search_value
            .pointer("/choices/0/message")
            .cloned()
            .ok_or_else(|| "Kimi 联网搜索未返回助手消息".to_string())?;
        let tool_calls = assistant
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if tool_calls.is_empty() {
            if let Some(content) = assistant
                .get("content")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "text_delta",
                    json!({"delta": content}),
                )?;
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "completed",
                    json!({}),
                )?;
                return Ok(());
            }
            send_event(
                &channel,
                &input,
                &request_id,
                &attempt_id,
                &mut sequence,
                "failed",
                json!({"message": "Kimi 未触发联网搜索，也未返回正文"}),
            )?;
            return Ok(());
        }
        let messages = body
            .get_mut("messages")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "Kimi 请求消息格式无效".to_string())?;
        messages.push(assistant);
        for tool_call in tool_calls {
            let id = tool_call
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Kimi 联网工具调用缺少 ID".to_string())?;
            let result = tool_call
                .pointer("/function/arguments")
                .and_then(Value::as_str)
                .ok_or_else(|| "Kimi 联网工具未返回搜索结果".to_string())?;
            messages.push(json!({ "role": "tool", "tool_call_id": id, "content": result }));
        }
        body["stream"] = json!(true);
    }
    let response = client
        .post(url)
        .headers(auth_headers(&input.auth, &secret)?)
        .json(&body)
        .send()
        .await
        .map_err(|_| "网络连接失败或 TLS 握手超时".to_string())?;
    if !response.status().is_success() {
        let message = security::sanitize_error(response.status());
        let _ = send_event(
            &channel,
            &input,
            &request_id,
            &attempt_id,
            &mut sequence,
            "failed",
            json!({"message": message}),
        );
        return Ok(());
    }

    let mut stream = response.bytes_stream().eventsource();
    let mut effective_event_seen = false;
    let mut completed = false;
    loop {
        let timeout = if effective_event_seen {
            Duration::from_secs(120)
        } else {
            Duration::from_secs(600)
        };
        let next = tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            result = tokio::time::timeout(timeout, stream.next()) => result,
        };
        let item = match next {
            Err(_) => {
                let message = if effective_event_seen {
                    "流式内容 120 秒无有效更新"
                } else {
                    "10 分钟内未收到首个有效生成事件"
                };
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "failed",
                    json!({"message": message}),
                )?;
                return Ok(());
            }
            Ok(None) => break,
            Ok(Some(Err(_))) => {
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "failed",
                    json!({"message": "SSE 流解析失败或连接中断"}),
                )?;
                return Ok(());
            }
            Ok(Some(Ok(event))) => event,
        };
        let data = item.data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            completed = true;
            send_event(
                &channel,
                &input,
                &request_id,
                &attempt_id,
                &mut sequence,
                "completed",
                json!({}),
            )?;
            break;
        }
        let value: Value = match serde_json::from_str(data) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if input.protocol == "responses" {
            let kind = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or(item.event.as_str());
            match kind {
                "response.output_text.delta" => {
                    if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                        effective_event_seen = true;
                        send_event(
                            &channel,
                            &input,
                            &request_id,
                            &attempt_id,
                            &mut sequence,
                            "text_delta",
                            json!({"delta": delta}),
                        )?;
                    }
                }
                "response.reasoning_text.delta" | "response.reasoning_summary_text.delta" => {
                    if !input.reasoning_enabled {
                        continue;
                    }
                    if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                        effective_event_seen = true;
                        send_event(
                            &channel,
                            &input,
                            &request_id,
                            &attempt_id,
                            &mut sequence,
                            "reasoning_delta",
                            json!({"delta": delta}),
                        )?;
                    }
                }
                "response.completed" => {
                    completed = true;
                    let usage = value
                        .pointer("/response/usage")
                        .cloned()
                        .unwrap_or(Value::Null);
                    if !usage.is_null() {
                        send_event(
                            &channel,
                            &input,
                            &request_id,
                            &attempt_id,
                            &mut sequence,
                            "usage",
                            usage,
                        )?;
                    }
                    send_event(
                        &channel,
                        &input,
                        &request_id,
                        &attempt_id,
                        &mut sequence,
                        "completed",
                        json!({}),
                    )?;
                    break;
                }
                "response.failed" | "error" => {
                    let message = value
                        .pointer("/response/error/message")
                        .or_else(|| value.pointer("/error/message"))
                        .and_then(Value::as_str)
                        .unwrap_or("供应商生成失败");
                    send_event(
                        &channel,
                        &input,
                        &request_id,
                        &attempt_id,
                        &mut sequence,
                        "failed",
                        json!({"message": message}),
                    )?;
                    return Ok(());
                }
                _ => {}
            }
        } else {
            if input.reasoning_enabled {
                if let Some(delta) = value
                    .pointer("/choices/0/delta/reasoning_content")
                    .and_then(Value::as_str)
                {
                    effective_event_seen = true;
                    send_event(
                        &channel,
                        &input,
                        &request_id,
                        &attempt_id,
                        &mut sequence,
                        "reasoning_delta",
                        json!({"delta": delta}),
                    )?;
                }
            }
            if let Some(delta) = value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                effective_event_seen = true;
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "text_delta",
                    json!({"delta": delta}),
                )?;
            }
            if let Some(usage) = value.get("usage") {
                send_event(
                    &channel,
                    &input,
                    &request_id,
                    &attempt_id,
                    &mut sequence,
                    "usage",
                    usage.clone(),
                )?;
            }
        }
    }
    if !completed {
        send_event(
            &channel,
            &input,
            &request_id,
            &attempt_id,
            &mut sequence,
            "failed",
            json!({"message": "连接已结束，但供应商未发送完成事件；已有文本已保留为不完整输出"}),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ChatMessage;

    fn input(protocol: &str) -> StreamChatInput {
        StreamChatInput {
            pane_id: "pane".into(),
            conversation_id: "conversation".into(),
            account_id: "account".into(),
            profile_id: "profile".into(),
            protocol: protocol.into(),
            auth: "bearer".into(),
            base_url: "https://example.com/v1".into(),
            model: "model".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hello".into(),
                reasoning_content: None,
                attachments: vec![],
            }],
            provider: "custom".into(),
            reasoning_enabled: true,
            reasoning_effort: "high".into(),
            parameters: json!({}),
            store: false,
        }
    }

    #[test]
    fn chat_body_is_compatible_and_does_not_force_usage_options() {
        let value = body_for(&input("chat_completions"), Path::new(".")).expect("body");
        assert_eq!(value["stream"], true);
        assert_eq!(value["reasoning_effort"], "high");
        assert!(value.get("stream_options").is_none());
        assert_eq!(value["messages"][0]["content"], "hello");
    }

    #[test]
    fn responses_body_disables_remote_storage() {
        let value = body_for(&input("responses"), Path::new(".")).expect("body");
        assert_eq!(value["store"], false);
        assert_eq!(value["reasoning"]["effort"], "high");
        assert_eq!(value["input"][0]["content"], "hello");
    }

    #[test]
    fn reasoning_controls_are_omitted_when_disabled() {
        let mut chat = input("chat_completions");
        chat.reasoning_enabled = false;
        let chat_body = body_for(&chat, Path::new(".")).expect("chat body");
        assert!(chat_body.get("reasoning_effort").is_none());

        let mut responses = input("responses");
        responses.reasoning_enabled = false;
        let responses_body = body_for(&responses, Path::new(".")).expect("responses body");
        assert!(responses_body.get("reasoning").is_none());
    }

    #[test]
    fn deepseek_uses_thinking_object_and_supported_effort() {
        let mut request = input("chat_completions");
        request.provider = "deepseek".into();
        request.parameters = json!({
            "thinkingMode": "enabled",
            "reasoningEffort": "max",
            "maxOutputTokens": 4096,
            "temperature": 0.7
        });
        let body = body_for(&request, Path::new(".")).expect("deepseek body");
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["reasoning_effort"], "max");
        assert_eq!(body["max_tokens"], 4096);
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn minimax_uses_current_completion_and_tier_fields() {
        let mut request = input("chat_completions");
        request.provider = "minimax".into();
        request.model = "MiniMax-M3".into();
        request.parameters = json!({
            "thinkingMode": "adaptive",
            "reasoningSplit": true,
            "serviceTier": "priority",
            "maxOutputTokens": 131072,
            "topP": 0.95
        });
        let body = body_for(&request, Path::new(".")).expect("minimax body");
        assert_eq!(body["thinking"]["type"], "adaptive");
        assert_eq!(body["reasoning_split"], true);
        assert_eq!(body["service_tier"], "priority");
        assert_eq!(body["max_completion_tokens"], 131072);
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn kimi_model_families_do_not_receive_incompatible_fields() {
        let mut k3 = input("chat_completions");
        k3.provider = "kimi".into();
        k3.model = "kimi-k3".into();
        k3.parameters = json!({ "thinkingMode": "enabled", "reasoningEffort": "max" });
        let k3_body = body_for(&k3, Path::new(".")).expect("kimi k3 body");
        assert_eq!(k3_body["reasoning_effort"], "max");
        assert!(k3_body.get("thinking").is_none());

        let mut k26 = k3;
        k26.model = "kimi-k2.6".into();
        k26.parameters = json!({ "thinkingMode": "disabled", "thinkingKeep": "all" });
        let k26_body = body_for(&k26, Path::new(".")).expect("kimi k2.6 body");
        assert_eq!(k26_body["thinking"]["type"], "disabled");
        assert_eq!(k26_body["thinking"]["keep"], "all");
        assert!(k26_body.get("reasoning_effort").is_none());
    }

    #[test]
    fn siliconflow_maps_thinking_budget_and_sampling_fields() {
        let mut request = input("chat_completions");
        request.provider = "siliconflow".into();
        request.parameters = json!({
            "thinkingMode": "enabled",
            "thinkingBudget": 1024,
            "reasoningEffort": "high",
            "maxOutputTokens": 4096,
            "topK": 50,
            "frequencyPenalty": 0.5
        });
        let body = body_for(&request, Path::new(".")).expect("siliconflow body");
        assert_eq!(body["enable_thinking"], true);
        assert_eq!(body["thinking_budget"], 1024);
        assert_eq!(body["reasoning_effort"], "high");
        assert_eq!(body["max_tokens"], 4096);
        assert_eq!(body["top_k"], 50);
    }

    #[test]
    fn native_web_search_fields_match_provider_protocols() {
        let mut openai = input("responses");
        openai.provider = "openai".into();
        openai.parameters = json!({ "webSearchEnabled": true });
        let openai_body = body_for(&openai, Path::new(".")).expect("openai search body");
        assert_eq!(openai_body["tools"][0]["type"], "web_search");

        let mut glm = input("chat_completions");
        glm.provider = "glm".into();
        glm.parameters = json!({ "webSearchEnabled": true });
        let glm_body = body_for(&glm, Path::new(".")).expect("glm search body");
        assert_eq!(glm_body["tools"][0]["web_search"]["enable"], true);

        let mut mimo = input("chat_completions");
        mimo.provider = "mimo".into();
        mimo.parameters = json!({ "webSearchEnabled": true });
        let mimo_body = body_for(&mimo, Path::new(".")).expect("mimo search body");
        assert_eq!(mimo_body["tools"][0]["max_keyword"], 3);

        let mut kimi = input("chat_completions");
        kimi.provider = "kimi".into();
        kimi.model = "kimi-k2.6".into();
        kimi.parameters = json!({ "webSearchEnabled": true, "thinkingMode": "enabled" });
        let kimi_body = body_for(&kimi, Path::new(".")).expect("kimi search body");
        assert_eq!(kimi_body["thinking"]["type"], "disabled");
        assert_eq!(kimi_body["tools"][0]["function"]["name"], "$web_search");
    }
}
