export type ProviderKind =
  | "openai"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "siliconflow"
  | "glm"
  | "mimo"
  | "custom";

export type ProtocolKind = "responses" | "chat_completions";
export type Capability = "supported" | "unsupported" | "unknown";
export type ReasoningEffort = "low" | "medium" | "high" | "max";
export type ThinkingMode = "provider_default" | "enabled" | "disabled" | "adaptive";

export interface ModelParameters {
  webSearchEnabled?: boolean;
  thinkingMode?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  thinkingKeep?: "provider_default" | "none" | "all";
  serviceTier?: "provider_default" | "standard" | "priority";
  reasoningSplit?: boolean;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  topK?: number;
  minP?: number;
  frequencyPenalty?: number;
}
export type PaneStatus =
  | "idle"
  | "queued"
  | "connecting"
  | "reasoning"
  | "streaming"
  | "completed"
  | "stopped"
  | "incomplete"
  | "failed";

export interface ProviderPreset {
  id: ProviderKind;
  name: string;
  baseUrl: string;
  protocol: ProtocolKind;
  color: string;
  docsUrl: string;
  auth: "bearer" | "api-key";
}

export interface ProviderAccount {
  id: string;
  presetId: ProviderKind;
  alias: string;
  baseUrl: string;
  protocol: ProtocolKind;
  auth: "bearer" | "api-key";
  secretConfigured: boolean;
  deletedAt?: string;
}

export interface ModelProfile {
  id: string;
  accountId: string;
  provider: ProviderKind;
  providerName: string;
  remoteModelId: string;
  displayName: string;
  color: string;
  enabled: boolean;
  capabilities: {
    images: Capability;
    reasoning: Capability;
    webSearch?: Capability;
  };
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  parameters?: ModelParameters;
}

export interface ContentBlock {
  type: "text" | "reasoning" | "image" | "error";
  text?: string;
  attachmentId?: string;
  name?: string;
  mime?: string;
  previewUrl?: string;
  byteSize?: number;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  dataUrl?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  label: string;
  createdAt: string;
  blocks: ContentBlock[];
  incomplete?: boolean;
}

export interface PaneThread {
  id: string;
  profileId: string;
  status: PaneStatus;
  messages: Message[];
  locked: boolean;
  contextEnabled: boolean;
  autoScroll: boolean;
  lockedSize?: { width: number; height: number };
  error?: string;
}

export interface QueuedPrompt {
  id: string;
  text: string;
  targetIds: string[];
  createdAt: string;
  paused: boolean;
  attachments: AttachmentRef[];
}

export interface SessionArchive {
  id: string;
  title: string;
  createdAt: string;
  profiles: ModelProfile[];
  threads: Record<string, PaneThread>;
  layout?: {
    columns: number;
    rows: number;
    columnWeights: number[];
    rowWeights: number[];
    autoLayout: boolean;
    composerSize: ComposerSize;
  };
}

export type PortableDataScope = "configuration" | "data" | "all";

export interface PortableTransferResult {
  path?: string;
  scope: PortableDataScope;
  profileCount: number;
  sessionCount: number;
  attachmentCount: number;
  importedAt?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  createdAt: string;
}

export type ComposerSize = "compact" | "normal" | "expanded";
export type ManagementSection =
  | "models"
  | "appearance"
  | "layout"
  | "conversation"
  | "history"
  | "prompts"
  | "privacy"
  | "shortcuts"
  | "about";

export type ModelManagerMode = "list" | "add" | "edit";

export interface SettingsRoute {
  section: ManagementSection;
  modelManagerMode: ModelManagerMode;
  modelProfileId?: string;
}

export interface UiSettings {
  theme: "black" | "white" | "light-gray" | "dark-gray" | "light-blue" | "light-green" | "custom";
  backgroundOpacity: number;
  textOpacity: number;
  uiFontSize: number;
  conversationFontSize: number;
  conversationLineHeight: number;
  messageSpacing: number;
  windowRadius: number;
  paneRadius: number;
  customBackgroundColor: string;
  customTextColor: string;
  alwaysOnTop: boolean;
  windowLocked: boolean;
  reducedMotion: boolean;
  defaultContextEnabled: boolean;
  includeInterruptedInContext: boolean;
  queueStrategy: "automatic" | "manual";
  promptInjectionEnabled: boolean;
  activePromptId?: string;
}

export interface StreamEnvelope {
  schemaVersion: number;
  requestId: string;
  attemptId: string;
  paneId: string;
  conversationId: string;
  sequence: number;
  timestamp: string;
  kind: "started" | "reasoning_delta" | "text_delta" | "usage" | "completed" | "failed";
  payload: Record<string, unknown>;
}

export interface StreamChatInput {
  paneId: string;
  conversationId: string;
  accountId: string;
  profileId: string;
  protocol: ProtocolKind;
  auth: "bearer" | "api-key";
  baseUrl: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string; reasoningContent?: string; attachments: AttachmentRef[] }>;
  provider: ProviderKind;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  parameters: ModelParameters;
  store: false;
}
