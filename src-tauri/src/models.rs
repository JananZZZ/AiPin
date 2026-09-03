use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccount {
    pub id: String,
    pub preset_id: String,
    pub alias: String,
    pub base_url: String,
    pub protocol: String,
    pub auth: String,
    pub secret_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    pub id: String,
    pub account_id: String,
    pub provider: String,
    pub provider_name: String,
    pub remote_model_id: String,
    pub display_name: String,
    pub color: String,
    pub enabled: bool,
    pub capabilities: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingAttachment {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChatInput {
    pub pane_id: String,
    pub conversation_id: String,
    pub account_id: String,
    pub profile_id: String,
    pub protocol: String,
    pub auth: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub provider: String,
    pub reasoning_enabled: bool,
    pub reasoning_effort: String,
    #[serde(default)]
    pub parameters: Value,
    pub store: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEnvelope {
    pub schema_version: u32,
    pub request_id: String,
    pub attempt_id: String,
    pub pane_id: String,
    pub conversation_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub kind: String,
    pub payload: Value,
}

impl StreamEnvelope {
    pub fn new(
        input: &StreamChatInput,
        request_id: &str,
        attempt_id: &str,
        sequence: u64,
        kind: &str,
        payload: Value,
    ) -> Self {
        Self {
            schema_version: 1,
            request_id: request_id.to_owned(),
            attempt_id: attempt_id.to_owned(),
            pane_id: input.pane_id.clone(),
            conversation_id: input.conversation_id.clone(),
            sequence,
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: kind.to_owned(),
            payload,
        }
    }
}
