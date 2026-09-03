import type { Capability, ModelParameters, ModelProfile, ProtocolKind, ProviderKind, ReasoningEffort, ThinkingMode } from "../types";

export interface WebSearchSupport {
  capability: Capability;
  label: string;
  detail: string;
  disablesThinking?: boolean;
}

export type VendorModelFamily =
  | "deepseek"
  | "minimax-m3"
  | "minimax-m2"
  | "minimax-unknown"
  | "kimi-k3"
  | "kimi-k27-code"
  | "kimi-k26"
  | "kimi-unknown"
  | "siliconflow"
  | "generic";

export function modelFamily(provider: ProviderKind, modelId: string): VendorModelFamily {
  const id = modelId.trim().toLowerCase();
  if (provider === "deepseek") return "deepseek";
  if (provider === "minimax") {
    if (id.startsWith("minimax-m3")) return "minimax-m3";
    if (id.startsWith("minimax-m2")) return "minimax-m2";
    return "minimax-unknown";
  }
  if (provider === "kimi") {
    if (id.startsWith("kimi-k3")) return "kimi-k3";
    if (id.startsWith("kimi-k2.7-code")) return "kimi-k27-code";
    if (id.startsWith("kimi-k2.6")) return "kimi-k26";
    return "kimi-unknown";
  }
  if (provider === "siliconflow") return "siliconflow";
  return "generic";
}

export function parametersFromProfile(profile?: Pick<ModelProfile, "parameters" | "reasoningEnabled" | "reasoningEffort">): ModelParameters {
  if (profile?.parameters) return { ...profile.parameters };
  return {
    thinkingMode: profile?.reasoningEnabled ? "enabled" : "disabled",
    reasoningEffort: profile?.reasoningEffort
  };
}

export function webSearchSupport(provider: ProviderKind, modelId: string, protocol?: ProtocolKind): WebSearchSupport {
  const id = modelId.trim().toLowerCase();
  if (provider === "openai") return protocol && protocol !== "responses"
    ? { capability: "unsupported", label: "当前协议不可用", detail: "OpenAI 原生联网工具由 Responses API 提供；请将协议改为 Responses-compatible。" }
    : { capability: "supported", label: "Responses 原生联网", detail: "请求会声明 web_search 工具；具体模型仍可能因能力或账号权限拒绝，并可能产生额外费用。" };
  if (provider === "kimi") {
    if (id.startsWith("kimi-k2.6")) return { capability: "supported", label: "Kimi 原生联网", detail: "使用 $web_search 官方工具；开启联网会自动关闭 K2.6 思考，并可能产生搜索费用。", disablesThinking: true };
    if (id.startsWith("kimi-k3") || id.startsWith("kimi-k2.7-code")) return { capability: "unsupported", label: "与始终思考模型不兼容", detail: "Kimi 官方 $web_search 要求关闭思考，而该模型的思考无法关闭。" };
    return { capability: "unknown", label: "模型待识别", detail: "仅对已确认支持且能关闭思考的 Kimi 模型开放，避免无效请求或重复计费。" };
  }
  if (provider === "glm") return id.startsWith("glm-")
    ? { capability: "supported", label: "GLM 对话联网", detail: "使用官方 Web Search in Chat 工具，默认由模型判断是否搜索；搜索服务会独立计费。" }
    : { capability: "unknown", label: "模型待识别", detail: "请填写标准 GLM 模型 ID 后启用官方对话联网。" };
  if (provider === "mimo") return id === "mimo-v2.5" || id === "mimo-v2.5-pro"
    ? { capability: "supported", label: "MiMo 原生联网", detail: "需先在 MiMo 控制台开通联网服务插件；模型按需搜索，搜索调用与追加输入 Token 会计费。" }
    : { capability: "unsupported", label: "当前模型不支持", detail: "MiMo 官方当前仅确认 mimo-v2.5 与 mimo-v2.5-pro 支持联网服务插件。" };
  if (provider === "deepseek") return { capability: "unsupported", label: "无托管联网工具", detail: "DeepSeek Chat API 提供函数调用，但未提供内置网页搜索；启用需要额外搜索服务，AiPin v1 不伪装成原生能力。" };
  if (provider === "minimax") return { capability: "unsupported", label: "当前端点不支持", detail: "MiniMax OpenAI Chat 端点只有通用工具调用；平台 Web Search MCP 是另一项服务，AiPin v1 尚未接入。" };
  if (provider === "siliconflow") return { capability: "unsupported", label: "无托管联网工具", detail: "硅基流动 Chat Completions 只声明通用函数工具，没有可直接开启的官方托管网页搜索。" };
  return { capability: "unknown", label: "自定义协议未知", detail: "通用兼容协议无法安全推断供应商的联网字段；暂不发送非标准参数。" };
}

export function effectiveThinking(provider: ProviderKind, modelId: string, parameters: ModelParameters, legacyEnabled = false) {
  const family = modelFamily(provider, modelId);
  if (parameters.webSearchEnabled && webSearchSupport(provider, modelId).disablesThinking) return false;
  if (parameters.thinkingMode === "disabled") return false;
  if (["deepseek", "minimax-m3", "minimax-m2", "kimi-k3", "kimi-k27-code"].includes(family)) return true;
  if (family === "kimi-k26") return true;
  return parameters.thinkingMode === "enabled" || parameters.thinkingMode === "adaptive" || legacyEnabled;
}

export function preservesReasoning(provider: ProviderKind, modelId: string, parameters: ModelParameters) {
  const family = modelFamily(provider, modelId);
  return provider === "kimi" && (
    family === "kimi-k3" ||
    family === "kimi-k27-code" ||
    (family === "kimi-k26" && parameters.thinkingKeep === "all")
  );
}

export const effortOptions = (family: VendorModelFamily): ReasoningEffort[] => {
  if (family === "deepseek" || family === "kimi-k3") return ["low", "high", "max"];
  if (family === "siliconflow") return ["high", "max"];
  return ["low", "medium", "high", "max"];
};

export function thinkingOptions(family: VendorModelFamily): Array<{ value: ThinkingMode; label: string }> {
  if (family === "deepseek") return [
    { value: "provider_default", label: "供应商默认（开启）" },
    { value: "enabled", label: "开启" },
    { value: "disabled", label: "关闭" }
  ];
  if (family === "minimax-m3") return [
    { value: "provider_default", label: "供应商默认（自适应）" },
    { value: "adaptive", label: "自适应思考" }
  ];
  if (family === "minimax-m2") return [{ value: "provider_default", label: "始终开启（模型限制）" }];
  if (family === "kimi-k3" || family === "kimi-k27-code") return [{ value: "provider_default", label: "始终开启（模型限制）" }];
  if (family === "kimi-k26") return [
    { value: "provider_default", label: "供应商默认（开启）" },
    { value: "enabled", label: "开启" },
    { value: "disabled", label: "关闭" }
  ];
  if (family === "minimax-unknown" || family === "kimi-unknown") return [{ value: "provider_default", label: "供应商默认（模型待识别）" }];
  return [
    { value: "provider_default", label: "供应商默认" },
    { value: "enabled", label: "开启" },
    { value: "disabled", label: "关闭" }
  ];
}

export function vendorParameterNote(family: VendorModelFamily) {
  switch (family) {
    case "deepseek": return "默认开启思考、强度为高；思考开启时 temperature 与 top_p 不生效，AiPin 会自动省略。";
    case "minimax-m3": return "M3 默认自适应思考；priority 会按官方说明提高准入优先级并按 1.5 倍计价。";
    case "minimax-m2": return "M2.x 的思考无法关闭；输出上限使用 max_completion_tokens，不发送已弃用的 max_tokens。";
    case "minimax-unknown": return "模型 ID 尚未匹配 MiniMax M3/M2.x 规则；AiPin 只提供端点通用参数，不猜测思考能力。";
    case "kimi-k3": return "K3 始终思考且保留式思考始终开启；只支持 low / high / max 推理强度，不发送 thinking。";
    case "kimi-k27-code": return "K2.7 Code 始终思考且始终保留推理；temperature 不可修改，也不发送 thinking。";
    case "kimi-k26": return "K2.6 默认开启思考，可关闭；temperature 不可修改，保留式思考可按需开启。";
    case "kimi-unknown": return "模型 ID 尚未匹配 K3/K2.7 Code/K2.6；AiPin 不猜测思考与温度能力，只发送安全的通用长度参数。";
    case "siliconflow": return "思考开关使用 enable_thinking；思考预算范围 128–32768。强度仅对官方列明的部分模型发送。";
    default: return "留空的生成参数不会发送，由供应商使用默认值。";
  }
}

export function sanitizeModelParameters(provider: ProviderKind, modelId: string, raw: ModelParameters, protocol?: ProtocolKind): ModelParameters {
  const family = modelFamily(provider, modelId);
  const number = (value: number | undefined, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
  const allowedModes = thinkingOptions(family).map((item) => item.value);
  const allowedEfforts = effortOptions(family);
  const result: ModelParameters = {
    webSearchEnabled: webSearchSupport(provider, modelId, protocol).capability === "supported" ? Boolean(raw.webSearchEnabled) : false,
    thinkingMode: allowedModes.includes(raw.thinkingMode ?? "provider_default") ? (raw.thinkingMode ?? "provider_default") : allowedModes[0],
    reasoningEffort: raw.reasoningEffort && allowedEfforts.includes(raw.reasoningEffort) ? raw.reasoningEffort : undefined,
    maxOutputTokens: number(raw.maxOutputTokens, 1, family === "minimax-m3" ? 524288 : family === "minimax-m2" ? 204800 : 1048576)
  };
  if (result.webSearchEnabled && webSearchSupport(provider, modelId, protocol).disablesThinking) result.thinkingMode = "disabled";
  if (family === "minimax-m3" || family === "minimax-m2" || family === "minimax-unknown") {
    result.temperature = number(raw.temperature, 0, 2);
    result.topP = number(raw.topP, 0, 1);
    result.serviceTier = raw.serviceTier ?? "provider_default";
    result.reasoningSplit = raw.reasoningSplit ?? true;
  } else if (family === "kimi-k26") {
    result.thinkingKeep = raw.thinkingKeep ?? "provider_default";
  } else if (family === "siliconflow") {
    result.temperature = number(raw.temperature, 0, 2);
    result.topP = number(raw.topP, 0, 1);
    result.topK = number(raw.topK, 0, 100);
    result.minP = number(raw.minP, 0, 1);
    result.frequencyPenalty = number(raw.frequencyPenalty, -2, 2);
    result.thinkingBudget = number(raw.thinkingBudget, 128, 32768);
  } else if (family !== "deepseek" && family !== "kimi-k3" && family !== "kimi-k27-code") {
    result.temperature = number(raw.temperature, 0, 2);
    result.topP = number(raw.topP, 0, 1);
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as ModelParameters;
}
