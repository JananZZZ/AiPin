import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelProfile, PaneThread, ProviderAccount, SessionArchive } from "../src/types";

const memory = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); }
};

let storeModule: typeof import("../src/store");

const account = (id: string): ProviderAccount => ({
  id,
  presetId: "deepseek",
  alias: id,
  baseUrl: "https://api.deepseek.com",
  protocol: "chat_completions",
  auth: "bearer",
  secretConfigured: true
});

const profile = (index: number, enabled = true): ModelProfile => ({
  id: `profile-${index}`,
  accountId: `account-${index}`,
  provider: "deepseek",
  providerName: "DeepSeek",
  remoteModelId: `deepseek-${index}`,
  displayName: `模型 ${index}`,
  color: "#3b82f6",
  enabled,
  capabilities: { images: "unknown", reasoning: "unknown" }
});

const thread = (profileId: string, text = ""): PaneThread => ({
  id: `thread-${profileId}`,
  profileId,
  status: "idle",
  locked: false,
  contextEnabled: false,
  autoScroll: true,
  messages: text ? [{
    id: `message-${profileId}`,
    role: "user",
    label: "你",
    createdAt: "2026-09-02T00:00:00.000Z",
    blocks: [{ type: "text", text }]
  }] : []
});

beforeAll(async () => {
  Object.defineProperty(globalThis, "window", { value: { localStorage: localStorageStub }, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, configurable: true });
  storeModule = await import("../src/store");
});

beforeEach(() => {
  memory.clear();
  storeModule.useAppStore.setState({
    accounts: [], profiles: [], threads: {}, selectedTargets: [], sessionHistory: [],
    columns: 2, rows: 1, columnWeights: [1.15, .85], rowWeights: [1], autoLayout: true
  });
});

describe("workspace model activation", () => {
  it("hides a pane without deleting its configuration, thread or history", () => {
    const configured = profile(1);
    const existingThread = thread(configured.id, "保留这段会话");
    storeModule.useAppStore.setState({
      accounts: [account("account-1")],
      profiles: [configured],
      threads: { [configured.id]: existingThread },
      selectedTargets: [configured.id]
    });

    expect(storeModule.useAppStore.getState().setModelWorkspaceEnabled(configured.id, false)).toBe(true);
    const state = storeModule.useAppStore.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].enabled).toBe(false);
    expect(state.threads[configured.id]).toBe(existingThread);
    expect(state.selectedTargets).not.toContain(configured.id);
  });

  it("enforces the 17-pane limit while allowing more configured models", () => {
    const profiles = Array.from({ length: 18 }, (_, index) => profile(index, index < 17));
    storeModule.useAppStore.setState({ profiles, selectedTargets: profiles.slice(0, 17).map((item) => item.id) });
    expect(storeModule.useAppStore.getState().setModelWorkspaceEnabled(profiles[17].id, true)).toBe(false);
    expect(storeModule.useAppStore.getState().profiles).toHaveLength(18);
    expect(storeModule.useAppStore.getState().profiles[17].enabled).toBe(false);
  });
});

describe("session restoration", () => {
  it("restores archived messages, active model set and the archived layout", () => {
    const archivedProfile = profile(1);
    const unrelatedProfile = profile(2);
    const archivedThread = thread(archivedProfile.id, "恢复成功");
    const archive: SessionArchive = {
      id: "archive-1",
      title: "恢复成功",
      createdAt: "2026-09-02T00:00:00.000Z",
      profiles: [archivedProfile],
      threads: { [archivedProfile.id]: archivedThread },
      layout: { columns: 2, rows: 1, columnWeights: [1.4, .6], rowWeights: [1], autoLayout: false, composerSize: "expanded" }
    };
    storeModule.useAppStore.setState({
      accounts: [account("account-1"), account("account-2")],
      profiles: [archivedProfile, unrelatedProfile],
      threads: { [archivedProfile.id]: thread(archivedProfile.id), [unrelatedProfile.id]: thread(unrelatedProfile.id) },
      selectedTargets: [unrelatedProfile.id],
      sessionHistory: [archive]
    });

    storeModule.useAppStore.getState().restoreSession(archive.id);
    const state = storeModule.useAppStore.getState();
    expect(state.profiles.find((item) => item.id === archivedProfile.id)?.enabled).toBe(true);
    expect(state.profiles.find((item) => item.id === unrelatedProfile.id)?.enabled).toBe(false);
    expect(state.threads[archivedProfile.id].messages[0].blocks[0].text).toBe("恢复成功");
    expect(state.selectedTargets).toEqual([archivedProfile.id]);
    expect([state.columns, state.rows, state.composerSize]).toEqual([2, 1, "expanded"]);
    expect(state.columnWeights).toEqual([1.4, .6]);
  });
});
