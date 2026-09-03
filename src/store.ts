import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createId } from "./lib/id";
import { layoutForModelCount } from "./lib/layoutSolver";
import type {
  AttachmentRef,
  ComposerSize,
  ManagementSection,
  Message,
  ModelProfile,
  PaneStatus,
  PaneThread,
  PromptTemplate,
  ProviderAccount,
  QueuedPrompt,
  SessionArchive,
  UiSettings
} from "./types";
import type { ModelManagerMode } from "./types";

interface AppStore {
  accounts: ProviderAccount[];
  profiles: ModelProfile[];
  threads: Record<string, PaneThread>;
  columns: number;
  rows: number;
  columnWeights: number[];
  rowWeights: number[];
  autoLayout: boolean;
  composerSize: ComposerSize;
  composerText: string;
  promptHistory: string[];
  selectedTargets: string[];
  queue: QueuedPrompt[];
  managementOpen: boolean;
  managementSection: ManagementSection;
  modelManagerMode: ModelManagerMode;
  modelManagerProfileId?: string;
  onboardingVisible: boolean;
  settings: UiSettings;
  promptTemplates: PromptTemplate[];
  sessionHistory: SessionArchive[];
  addModel: (account: ProviderAccount, profile: ModelProfile) => void;
  removeModel: (profileId: string) => void;
  setModelWorkspaceEnabled: (profileId: string, enabled: boolean) => boolean;
  updateModel: (profileId: string, patch: Partial<ModelProfile>) => void;
  updateAccount: (accountId: string, patch: Partial<ProviderAccount>) => void;
  setGrid: (columns: number, rows: number) => void;
  setAutoLayout: (enabled: boolean) => void;
  resizeTrack: (axis: "column" | "row", index: number, deltaRatio: number) => void;
  reorderProfiles: (sourceId: string, targetId: string) => void;
  setComposerSize: (size: ComposerSize) => void;
  setComposerText: (text: string) => void;
  recordPrompt: (text: string) => void;
  toggleTarget: (profileId: string) => void;
  selectAllTargets: () => void;
  enqueue: (prompt: QueuedPrompt) => void;
  dequeue: (id: string) => void;
  reorderQueue: (id: string, direction: -1 | 1) => void;
  setQueuePaused: (id: string, paused: boolean) => void;
  setManagement: (open: boolean, section?: ManagementSection) => void;
  openModelManager: (mode: ModelManagerMode, profileId?: string) => void;
  setModelManagerRoute: (mode: ModelManagerMode, profileId?: string) => void;
  dismissOnboarding: () => void;
  updateSettings: (patch: Partial<UiSettings>) => void;
  togglePaneLock: (profileId: string, size?: { width: number; height: number }) => void;
  fitLockedTracks: (width: number, height: number) => void;
  toggleContext: (profileId: string) => void;
  appendUserMessage: (profileId: string, text: string, attachments?: AttachmentRef[]) => string;
  beginAssistantMessage: (profileId: string) => string;
  appendAssistantDelta: (profileId: string, messageId: string, delta: string) => void;
  appendReasoningDelta: (profileId: string, messageId: string, delta: string) => void;
  setPaneStatus: (profileId: string, status: PaneStatus, error?: string) => void;
  clearThread: (profileId: string, archive?: boolean) => void;
  clearAllThreads: (archive?: boolean) => void;
  resetAllData: () => void;
  savePromptTemplate: (template: PromptTemplate) => void;
  removePromptTemplate: (id: string) => void;
  restoreSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

export const defaultSettings: UiSettings = {
  theme: "black",
  backgroundOpacity: 100,
  textOpacity: 100,
  uiFontSize: 14,
  conversationFontSize: 14,
  conversationLineHeight: 1.48,
  messageSpacing: 14,
  windowRadius: 8,
  paneRadius: 6,
  customBackgroundColor: "#111316",
  customTextColor: "#f4f4f5",
  alwaysOnTop: false,
  windowLocked: false,
  reducedMotion: false,
  defaultContextEnabled: false,
  includeInterruptedInContext: false,
  queueStrategy: "automatic",
  promptInjectionEnabled: false
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeUiSettings(value?: Partial<UiSettings> & { radius?: number }): UiSettings {
  const legacyRadius = value?.radius;
  const themes: UiSettings["theme"][] = ["black", "white", "light-gray", "dark-gray", "light-blue", "light-green", "custom"];
  return {
    ...defaultSettings,
    ...value,
    theme: value?.theme && themes.includes(value.theme) ? value.theme : defaultSettings.theme,
    backgroundOpacity: clamp(value?.backgroundOpacity, 0, 100, defaultSettings.backgroundOpacity),
    textOpacity: clamp(value?.textOpacity, 0, 100, defaultSettings.textOpacity),
    uiFontSize: clamp(value?.uiFontSize, 5, 30, defaultSettings.uiFontSize),
    conversationFontSize: clamp(value?.conversationFontSize, 5, 30, defaultSettings.conversationFontSize),
    conversationLineHeight: clamp(value?.conversationLineHeight, 1.1, 2.2, defaultSettings.conversationLineHeight),
    messageSpacing: clamp(value?.messageSpacing, 4, 32, defaultSettings.messageSpacing),
    windowRadius: clamp(value?.windowRadius ?? legacyRadius, 0, 30, defaultSettings.windowRadius),
    paneRadius: clamp(value?.paneRadius ?? (legacyRadius == null ? undefined : legacyRadius - 2), 0, 30, defaultSettings.paneRadius),
    customBackgroundColor: /^#[0-9a-f]{6}$/i.test(value?.customBackgroundColor ?? "") ? value!.customBackgroundColor! : defaultSettings.customBackgroundColor,
    customTextColor: /^#[0-9a-f]{6}$/i.test(value?.customTextColor ?? "") ? value!.customTextColor! : defaultSettings.customTextColor,
    queueStrategy: value?.queueStrategy === "manual" ? "manual" : "automatic"
  };
}

function newThread(profileId: string, contextEnabled = false): PaneThread {
  return {
    id: createId("thread"),
    profileId,
    status: "idle",
    messages: [],
    locked: false,
    contextEnabled,
    autoScroll: true
  };
}

export function createPaneThread(profileId: string, contextEnabled = false): PaneThread {
  return newThread(profileId, contextEnabled);
}

function defaultColumnWeights(columns: number) {
  return columns === 2 ? [1.15, .85] : Array.from({ length: columns }, () => 1);
}

const memoryOnlyStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

function activeProfiles(profiles: ModelProfile[]) {
  return profiles.filter((profile) => profile.enabled !== false);
}

function makeArchive(
  profiles: ModelProfile[],
  threads: Record<string, PaneThread>,
  profileIds?: string[],
  layout?: SessionArchive["layout"]
): SessionArchive | undefined {
  const includedProfiles = profiles.filter((profile) => profile.enabled !== false && (!profileIds || profileIds.includes(profile.id)));
  const includedThreads = Object.fromEntries(includedProfiles.flatMap((profile) => {
    const thread = threads[profile.id];
    // Store updates are immutable, so this snapshot stays stable without cloning a
    // potentially huge 17-pane conversation on the UI thread.
    return thread?.messages.length ? [[profile.id, thread] as const] : [];
  }));
  const firstMessage = Object.values(includedThreads)
    .flatMap((thread) => thread.messages)
    .filter((message) => message.role === "user")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!firstMessage) return undefined;
  return {
    id: createId("session"),
    title: firstMessage.blocks.find((block) => block.type === "text")?.text?.trim().slice(0, 80) || "未命名会话",
    createdAt: firstMessage.createdAt,
    profiles: includedProfiles.map((profile) => ({ ...profile, parameters: profile.parameters ? { ...profile.parameters } : undefined })),
    threads: includedThreads,
    layout
  };
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      accounts: [],
      profiles: [],
      threads: {},
      columns: 2,
      rows: 1,
      columnWeights: [1.15, .85],
      rowWeights: [1],
      autoLayout: true,
      composerSize: "normal",
      composerText: "",
      promptHistory: [],
      selectedTargets: [],
      queue: [],
      managementOpen: false,
      managementSection: "models",
      modelManagerMode: "list",
      modelManagerProfileId: undefined,
      onboardingVisible: true,
      settings: defaultSettings,
      promptTemplates: [],
      sessionHistory: [],

      addModel: (account, profile) =>
        set((state) => {
          const enabled = activeProfiles(state.profiles).length < 17;
          const nextProfile = { ...profile, enabled };
          const profiles = [...state.profiles, nextProfile];
          const activeCount = activeProfiles(profiles).length;
          const mustExpand = state.columns * state.rows < activeCount + 1;
          const layout = state.autoLayout || mustExpand ? layoutForModelCount(activeCount) : { columns: state.columns, rows: state.rows };
          return {
            accounts: [...state.accounts.filter((item) => item.id !== account.id), account],
            profiles,
            threads: { ...state.threads, [profile.id]: newThread(profile.id, state.settings.defaultContextEnabled) },
            selectedTargets: enabled ? Array.from(new Set([...state.selectedTargets, profile.id])) : state.selectedTargets,
            columns: layout.columns,
            rows: layout.rows,
            columnWeights: defaultColumnWeights(layout.columns),
            rowWeights: Array.from({ length: layout.rows }, () => 1),
            managementOpen: false
          };
        }),

      removeModel: (profileId) =>
        set((state) => {
          const profiles = state.profiles.filter((profile) => profile.id !== profileId);
          const activeCount = activeProfiles(profiles).length;
          const layout = state.autoLayout ? layoutForModelCount(activeCount) : { columns: state.columns, rows: state.rows };
          return {
            profiles,
            selectedTargets: state.selectedTargets.filter((id) => id !== profileId),
            ...layout,
            ...(state.autoLayout ? {
              columnWeights: defaultColumnWeights(layout.columns),
              rowWeights: Array.from({ length: layout.rows }, () => 1)
            } : {})
          };
        }),
      setModelWorkspaceEnabled: (profileId, enabled) => {
        let changed = false;
        set((state) => {
          const profile = state.profiles.find((item) => item.id === profileId);
          if (!profile || profile.enabled === enabled) return state;
          if (enabled && activeProfiles(state.profiles).length >= 17) return state;
          changed = true;
          const profiles = state.profiles.map((item) => item.id === profileId ? { ...item, enabled } : item);
          const activeCount = activeProfiles(profiles).length;
          const mustExpand = state.columns * state.rows < activeCount + 1;
          const layout = state.autoLayout || mustExpand ? layoutForModelCount(activeCount) : { columns: state.columns, rows: state.rows };
          return {
            profiles,
            threads: state.threads[profileId] ? state.threads : { ...state.threads, [profileId]: newThread(profileId, state.settings.defaultContextEnabled) },
            selectedTargets: enabled
              ? Array.from(new Set([...state.selectedTargets, profileId]))
              : state.selectedTargets.filter((id) => id !== profileId),
            ...layout,
            ...(state.autoLayout || mustExpand ? {
              columnWeights: defaultColumnWeights(layout.columns),
              rowWeights: Array.from({ length: layout.rows }, () => 1)
            } : {})
          };
        });
        return changed;
      },
      updateModel: (profileId, patch) => set((state) => ({
        profiles: state.profiles.map((profile) => profile.id === profileId ? { ...profile, ...patch } : profile)
      })),
      updateAccount: (accountId, patch) => set((state) => ({
        accounts: state.accounts.map((account) => account.id === accountId ? { ...account, ...patch } : account)
      })),

      setGrid: (columns, rows) => {
        const requested = { columns: Math.min(6, Math.max(1, columns)), rows: Math.min(3, Math.max(1, rows)) };
        const count = activeProfiles(get().profiles).length;
        const required = Math.max(2, count + 1);
        const layout = requested.columns * requested.rows >= required ? requested : layoutForModelCount(count);
        set({
          ...layout,
          columnWeights: defaultColumnWeights(layout.columns),
          rowWeights: Array.from({ length: layout.rows }, () => 1),
          autoLayout: false
        });
      },
      setAutoLayout: (autoLayout) => {
        const layout = autoLayout ? layoutForModelCount(activeProfiles(get().profiles).length) : { columns: get().columns, rows: get().rows };
        set({
          autoLayout,
          ...layout,
          columnWeights: defaultColumnWeights(layout.columns),
          rowWeights: Array.from({ length: layout.rows }, () => 1)
        });
      },
      resizeTrack: (axis, index, deltaRatio) =>
        set((state) => {
          const source = axis === "column" ? state.columnWeights : state.rowWeights;
          if (index < 0 || index >= source.length - 1) return state;
          const weights = [...source];
          const total = weights.reduce((sum, value) => sum + value, 0);
          const min = Math.max(total * .055, .12);
          const requested = deltaRatio * total;
          const allowed = Math.max(min - weights[index], Math.min(weights[index + 1] - min, requested));
          weights[index] += allowed;
          weights[index + 1] -= allowed;
          return axis === "column" ? { columnWeights: weights } : { rowWeights: weights };
        }),
      reorderProfiles: (sourceId, targetId) =>
        set((state) => {
          const profiles = [...state.profiles];
          const source = profiles.findIndex((profile) => profile.id === sourceId);
          const target = profiles.findIndex((profile) => profile.id === targetId);
          if (source < 0 || target < 0 || source === target) return state;
          if (state.threads[sourceId]?.locked || state.threads[targetId]?.locked) return state;
          const [moved] = profiles.splice(source, 1);
          profiles.splice(target, 0, moved);
          return { profiles };
        }),
      setComposerSize: (composerSize) => set({ composerSize }),
      setComposerText: (composerText) => set({ composerText }),
      recordPrompt: (text) => set((state) => {
        const normalized = text.trim();
        if (!normalized) return state;
        return { promptHistory: [...state.promptHistory.filter((item) => item !== normalized), normalized].slice(-50) };
      }),
      toggleTarget: (profileId) =>
        set((state) => state.profiles.some((profile) => profile.id === profileId && profile.enabled !== false) ? ({
          selectedTargets: state.selectedTargets.includes(profileId)
            ? state.selectedTargets.filter((id) => id !== profileId)
            : [...state.selectedTargets, profileId]
        }) : state),
      selectAllTargets: () => set((state) => ({ selectedTargets: activeProfiles(state.profiles).map((profile) => profile.id) })),
      enqueue: (prompt) => set((state) => ({ queue: [...state.queue, prompt] })),
      dequeue: (id) => set((state) => ({ queue: state.queue.filter((item) => item.id !== id) })),
      reorderQueue: (id, direction) =>
        set((state) => {
          const queue = [...state.queue];
          const index = queue.findIndex((item) => item.id === id);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= queue.length) return state;
          [queue[index], queue[target]] = [queue[target], queue[index]];
          return { queue };
        }),
      setQueuePaused: (id, paused) => set((state) => ({ queue: state.queue.map((item) => item.id === id ? { ...item, paused } : item) })),
      setManagement: (managementOpen, managementSection = get().managementSection) => set({
        managementOpen,
        managementSection,
        ...(managementOpen && managementSection === "models" ? { modelManagerMode: "list" as const, modelManagerProfileId: undefined } : {})
      }),
      openModelManager: (modelManagerMode, modelManagerProfileId) => set({
        managementOpen: true,
        managementSection: "models",
        modelManagerMode,
        modelManagerProfileId: modelManagerMode === "edit" ? modelManagerProfileId : undefined
      }),
      setModelManagerRoute: (modelManagerMode, modelManagerProfileId) => set({
        managementSection: "models",
        modelManagerMode,
        modelManagerProfileId: modelManagerMode === "edit" ? modelManagerProfileId : undefined
      }),
      dismissOnboarding: () => set({ onboardingVisible: false }),
      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      togglePaneLock: (profileId, size) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [profileId]: {
              ...state.threads[profileId],
              locked: !state.threads[profileId]?.locked,
              lockedSize: state.threads[profileId]?.locked ? undefined : size
            }
          }
        })),
      fitLockedTracks: (width, height) => set((state) => {
        const fit = (axis: "column" | "row", count: number, available: number, weights: number[]) => {
          if (count <= 0 || available <= 0) return weights;
          const locked = new Map<number, number>();
          activeProfiles(state.profiles).forEach((profile, index) => {
            const thread = state.threads[profile.id];
            if (!thread?.locked || !thread.lockedSize) return;
            const coordinate = axis === "column" ? index % state.columns : Math.floor(index / state.columns);
            if (coordinate < count) locked.set(coordinate, axis === "column" ? thread.lockedSize.width : thread.lockedSize.height);
          });
          if (!locked.size) return weights;
          const usable = Math.max(count * 24, available - (count - 1) * 4 - 8);
          const fixed = Array.from(locked.values()).reduce((sum, value) => sum + value, 0);
          const unlocked = Array.from({ length: count }, (_, index) => index).filter((index) => !locked.has(index));
          const remaining = Math.max(unlocked.length * 24, usable - fixed);
          const sourceTotal = unlocked.reduce((sum, index) => sum + (weights[index] ?? 1), 0) || unlocked.length || 1;
          return Array.from({ length: count }, (_, index) => locked.get(index) ?? remaining * ((weights[index] ?? 1) / sourceTotal));
        };
        return {
          columnWeights: fit("column", state.columns, width, state.columnWeights),
          rowWeights: fit("row", state.rows, height, state.rowWeights)
        };
      }),
      toggleContext: (profileId) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [profileId]: { ...state.threads[profileId], contextEnabled: !state.threads[profileId]?.contextEnabled }
          }
        })),
      appendUserMessage: (profileId, text, attachments = []) => {
        const id = createId("message");
        const message: Message = {
          id,
          role: "user",
          label: "你",
          createdAt: new Date().toISOString(),
          blocks: [
            { type: "text", text },
            ...attachments.map((attachment) => ({
              type: "image" as const,
              attachmentId: attachment.id,
              name: attachment.name,
              mime: attachment.mime,
              previewUrl: attachment.dataUrl,
              byteSize: attachment.byteSize
            }))
          ]
        };
        set((state) => ({
          threads: {
            ...state.threads,
            [profileId]: {
              ...(state.threads[profileId] ?? newThread(profileId)),
              messages: [...(state.threads[profileId]?.messages ?? []), message],
              error: undefined
            }
          }
        }));
        return id;
      },
      beginAssistantMessage: (profileId) => {
        const id = createId("message");
        const profile = get().profiles.find((item) => item.id === profileId);
        const message: Message = {
          id,
          role: "assistant",
          label: profile?.displayName || profile?.providerName || "AI",
          createdAt: new Date().toISOString(),
          blocks: [{ type: "reasoning", text: "" }, { type: "text", text: "" }]
        };
        set((state) => ({
          threads: {
            ...state.threads,
            [profileId]: {
              ...(state.threads[profileId] ?? newThread(profileId)),
              messages: [...(state.threads[profileId]?.messages ?? []), message]
            }
          }
        }));
        return id;
      },
      appendAssistantDelta: (profileId, messageId, delta) =>
        set((state) => {
          const thread = state.threads[profileId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [profileId]: {
                ...thread,
                messages: thread.messages.map((message) =>
                  message.id !== messageId
                    ? message
                    : {
                        ...message,
                        blocks: message.blocks.map((block) =>
                          block.type === "text" ? { ...block, text: `${block.text ?? ""}${delta}` } : block
                        )
                      }
                )
              }
            }
          };
        }),
      appendReasoningDelta: (profileId, messageId, delta) => set((state) => {
        const thread = state.threads[profileId];
        if (!thread) return state;
        return { threads: { ...state.threads, [profileId]: { ...thread, messages: thread.messages.map((message) => message.id === messageId ? { ...message, blocks: message.blocks.map((block) => block.type === "reasoning" ? { ...block, text: `${block.text ?? ""}${delta}` } : block) } : message) } } };
      }),
      setPaneStatus: (profileId, status, error) =>
        set((state) => {
          const thread = state.threads[profileId] ?? newThread(profileId, state.settings.defaultContextEnabled);
          const incomplete = ["stopped", "incomplete", "failed"].includes(status);
          const messages = incomplete ? thread.messages.map((message, index) => index === thread.messages.length - 1 && message.role === "assistant" ? { ...message, incomplete: true } : message) : thread.messages;
          return { threads: { ...state.threads, [profileId]: { ...thread, messages, status, error } } };
        }),
      clearThread: (profileId, shouldArchive = true) =>
        set((state) => {
          const archive = shouldArchive ? makeArchive(state.profiles, state.threads, [profileId], {
            columns: state.columns, rows: state.rows, columnWeights: state.columnWeights, rowWeights: state.rowWeights,
            autoLayout: state.autoLayout, composerSize: state.composerSize
          }) : undefined;
          return {
            threads: { ...state.threads, [profileId]: newThread(profileId, state.settings.defaultContextEnabled) },
            sessionHistory: archive ? [archive, ...state.sessionHistory] : state.sessionHistory,
            queue: state.queue.map((item) => item.targetIds.includes(profileId) ? { ...item, paused: true } : item)
          };
        }),
      clearAllThreads: (shouldArchive = true) =>
        set((state) => {
          const archive = shouldArchive ? makeArchive(state.profiles, state.threads, undefined, {
            columns: state.columns, rows: state.rows, columnWeights: state.columnWeights, rowWeights: state.rowWeights,
            autoLayout: state.autoLayout, composerSize: state.composerSize
          }) : undefined;
          return {
            threads: Object.fromEntries(state.profiles.map((profile) => [profile.id, newThread(profile.id, state.settings.defaultContextEnabled)])),
            sessionHistory: archive ? [archive, ...state.sessionHistory] : state.sessionHistory,
            queue: state.queue.map((item) => ({ ...item, paused: true }))
          };
        }),
      savePromptTemplate: (template) => set((state) => ({ promptTemplates: [...state.promptTemplates.filter((item) => item.id !== template.id), template] })),
      removePromptTemplate: (id) => set((state) => ({
        promptTemplates: state.promptTemplates.filter((item) => item.id !== id),
        settings: state.settings.activePromptId === id ? { ...state.settings, activePromptId: undefined, promptInjectionEnabled: false } : state.settings
      })),
      restoreSession: (id) => set((state) => {
        const archive = state.sessionHistory.find((item) => item.id === id);
        if (!archive) return state;
        const archivedProfiles = archive.profiles.slice(0, 17);
        const archivedIds = new Set(archivedProfiles.map((profile) => profile.id));
        const profiles = state.profiles.map((profile) => ({ ...profile, enabled: archivedIds.has(profile.id) }));
        for (const archivedProfile of archivedProfiles) {
          if (!profiles.some((item) => item.id === archivedProfile.id) && state.accounts.some((account) => account.id === archivedProfile.accountId)) {
            profiles.push({ ...archivedProfile, enabled: true });
          }
        }
        const restoredIds = new Set(activeProfiles(profiles).map((profile) => profile.id));
        const threads = { ...state.threads };
        for (const [profileId, thread] of Object.entries(archive.threads)) {
          if (restoredIds.has(profileId)) threads[profileId] = structuredClone(thread);
        }
        const activeCount = restoredIds.size;
        const archivedLayout = archive.layout;
        const archivedLayoutValid = archivedLayout
          && archivedLayout.columns >= 1 && archivedLayout.columns <= 6
          && archivedLayout.rows >= 1 && archivedLayout.rows <= 3
          && archivedLayout.columns * archivedLayout.rows >= activeCount + 1;
        const layout = archivedLayoutValid
          ? { columns: archivedLayout.columns, rows: archivedLayout.rows }
          : layoutForModelCount(activeCount);
        return {
          profiles,
          threads,
          selectedTargets: Array.from(restoredIds),
          ...layout,
          autoLayout: archivedLayoutValid ? archivedLayout.autoLayout : true,
          composerSize: archivedLayoutValid ? archivedLayout.composerSize : state.composerSize,
          columnWeights: archivedLayoutValid && archivedLayout.columnWeights.length === layout.columns
            ? [...archivedLayout.columnWeights] : defaultColumnWeights(layout.columns),
          rowWeights: archivedLayoutValid && archivedLayout.rowWeights.length === layout.rows
            ? [...archivedLayout.rowWeights] : Array.from({ length: layout.rows }, () => 1),
          managementOpen: false
        };
      }),
      deleteSession: (id) => set((state) => ({ sessionHistory: state.sessionHistory.filter((item) => item.id !== id) })),
      resetAllData: () => set({
        accounts: [],
        profiles: [],
        threads: {},
        columns: 2,
        rows: 1,
        columnWeights: [1.15, .85],
        rowWeights: [1],
        autoLayout: true,
        composerSize: "normal",
        composerText: "",
        promptHistory: [],
        selectedTargets: [],
        queue: [],
        onboardingVisible: true,
        settings: defaultSettings,
        promptTemplates: [],
        sessionHistory: []
      })
    }),
    {
      name: "aipin-ui-snapshot-v1",
      storage: createJSONStorage(() => "__TAURI_INTERNALS__" in window ? memoryOnlyStorage : localStorage),
      partialize: (state) => ({
        accounts: state.accounts,
        profiles: state.profiles,
        threads: state.threads,
        columns: state.columns,
        rows: state.rows,
        columnWeights: state.columnWeights,
        rowWeights: state.rowWeights,
        autoLayout: state.autoLayout,
        composerSize: state.composerSize,
        promptHistory: state.promptHistory,
        selectedTargets: state.selectedTargets,
        queue: state.queue.map((item) => ({ ...item, paused: true })),
        onboardingVisible: state.onboardingVisible,
        settings: state.settings,
        promptTemplates: state.promptTemplates,
        sessionHistory: state.sessionHistory
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppStore> & { settings?: Partial<UiSettings> & { radius?: number } };
        const profiles = saved.profiles ?? current.profiles;
        const activeCount = activeProfiles(profiles).length;
        const shouldMigrateLayout = saved.autoLayout !== false && saved.columns === 4 && activeCount <= 1;
        const columns = shouldMigrateLayout ? Math.max(2, activeCount + 1) : Math.min(6, Math.max(1, saved.columns ?? current.columns));
        const rows = Math.min(3, Math.max(1, saved.rows ?? current.rows));
        const threads = Object.fromEntries(profiles.map((profile) => [profile.id, saved.threads?.[profile.id] ?? newThread(profile.id, saved.settings?.defaultContextEnabled ?? false)]));
        return {
          ...current,
          ...saved,
          profiles,
          columns,
          rows,
          threads,
          selectedTargets: (saved.selectedTargets ?? activeProfiles(profiles).map((profile) => profile.id)).filter((id) => profiles.some((profile) => profile.id === id && profile.enabled !== false)),
          columnWeights: shouldMigrateLayout || saved.columnWeights?.length !== columns ? defaultColumnWeights(columns) : saved.columnWeights,
          rowWeights: saved.rowWeights?.length === rows ? saved.rowWeights : Array.from({ length: rows }, () => 1),
          promptTemplates: saved.promptTemplates ?? [],
          promptHistory: (saved.promptHistory ?? []).filter((item) => typeof item === "string" && item.trim()).slice(-50),
          sessionHistory: saved.sessionHistory ?? [],
          queue: (saved.queue ?? []).map((item) => ({ ...item, attachments: item.attachments ?? [], paused: true })),
          settings: normalizeUiSettings(saved.settings)
        } as AppStore;
      }
    }
  )
);
