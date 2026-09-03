import type { ProviderPreset } from "../types";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
    color: "#34d399",
    docsUrl: "https://platform.openai.com/docs/quickstart",
    auth: "bearer"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    protocol: "chat_completions",
    color: "#3b82f6",
    docsUrl: "https://api-docs.deepseek.com/zh-cn/",
    auth: "bearer"
  },
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "chat_completions",
    color: "#2563eb",
    docsUrl: "https://platform.kimi.com/docs/guide/use-thinking-models",
    auth: "bearer"
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.cn/v1",
    protocol: "chat_completions",
    color: "#f04438",
    docsUrl: "https://platform.minimaxi.com/docs/api-reference/text-chat-openai",
    auth: "bearer"
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "chat_completions",
    color: "#14b8a6",
    docsUrl: "https://api-docs.siliconflow.cn/docs/userguide/quickstart",
    auth: "bearer"
  },
  {
    id: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat_completions",
    color: "#a855f7",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction",
    auth: "bearer"
  },
  {
    id: "mimo",
    name: "MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    protocol: "chat_completions",
    color: "#f59e0b",
    docsUrl: "https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call",
    auth: "api-key"
  },
  {
    id: "custom",
    name: "自定义",
    baseUrl: "http://127.0.0.1:11434/v1",
    protocol: "chat_completions",
    color: "#14b8a6",
    docsUrl: "",
    auth: "bearer"
  }
];

export const presetById = (id: string) => PROVIDER_PRESETS.find((preset) => preset.id === id);
