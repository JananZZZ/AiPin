import { describe, expect, it } from "vitest";
import {
  effectiveThinking,
  modelFamily,
  preservesReasoning,
  sanitizeModelParameters,
  thinkingOptions,
  webSearchSupport
} from "../src/lib/modelParameters";

describe("vendor model parameters", () => {
  it("classifies the Kimi families whose wire formats differ", () => {
    expect(modelFamily("kimi", "kimi-k3")).toBe("kimi-k3");
    expect(modelFamily("kimi", "kimi-k2.7-code-highspeed")).toBe("kimi-k27-code");
    expect(modelFamily("kimi", "kimi-k2.6")).toBe("kimi-k26");
  });

  it("does not offer a false off switch for always-thinking models", () => {
    expect(thinkingOptions("kimi-k3")).toEqual([{ value: "provider_default", label: "始终开启（模型限制）" }]);
    expect(thinkingOptions("minimax-m2")).toHaveLength(1);
  });

  it("clamps SiliconFlow budgets and removes unsupported effort levels", () => {
    const parameters = sanitizeModelParameters("siliconflow", "deepseek-ai/DeepSeek-V4-Flash", {
      thinkingMode: "enabled",
      thinkingBudget: 90000,
      reasoningEffort: "low",
      topK: 180,
      frequencyPenalty: -8
    });
    expect(parameters.thinkingBudget).toBe(32768);
    expect(parameters.reasoningEffort).toBeUndefined();
    expect(parameters.topK).toBe(100);
    expect(parameters.frequencyPenalty).toBe(-2);
  });

  it("tracks effective and preserved thinking separately", () => {
    expect(effectiveThinking("deepseek", "deepseek-v4-pro", { thinkingMode: "provider_default" })).toBe(true);
    expect(effectiveThinking("deepseek", "deepseek-v4-pro", { thinkingMode: "disabled" })).toBe(false);
    expect(preservesReasoning("kimi", "kimi-k3", {})).toBe(true);
    expect(preservesReasoning("kimi", "kimi-k2.6", { thinkingKeep: "all" })).toBe(true);
    expect(preservesReasoning("kimi", "kimi-k2.6", { thinkingKeep: "none" })).toBe(false);
  });
});

describe("native web search capability", () => {
  it("only enables officially mapped provider/model combinations", () => {
    expect(webSearchSupport("openai", "gpt-5", "responses").capability).toBe("supported");
    expect(webSearchSupport("openai", "gpt-4o", "chat_completions").capability).toBe("unsupported");
    expect(webSearchSupport("deepseek", "deepseek-chat").capability).toBe("unsupported");
    expect(webSearchSupport("glm", "glm-5.2").capability).toBe("supported");
    expect(webSearchSupport("mimo", "mimo-v2.5-pro").capability).toBe("supported");
  });

  it("forces Kimi K2.6 thinking off when native search is enabled", () => {
    const safe = sanitizeModelParameters("kimi", "kimi-k2.6", { webSearchEnabled: true, thinkingMode: "enabled" }, "chat_completions");
    expect(safe.webSearchEnabled).toBe(true);
    expect(safe.thinkingMode).toBe("disabled");
    expect(effectiveThinking("kimi", "kimi-k2.6", safe, true)).toBe(false);
  });
});
