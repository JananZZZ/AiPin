import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { Workspace } from "./features/Workspace";
import { createPaneThread, normalizeUiSettings, useAppStore } from "./store";
import { isTauri, nativeInvoke } from "./lib/platform";
import type { ManagementSection, SettingsRoute, UiSettings } from "./types";

const ManagementView = lazy(() => import("./features/ManagementView").then((module) => ({ default: module.ManagementView })));

const paletteByTheme: Record<Exclude<UiSettings["theme"], "custom">, Record<string, string>> = {
  black: { canvas: "oklch(.05 0 0)", surface: "oklch(.105 .006 220)", hover: "oklch(.135 .008 220)", raised: "oklch(.16 .008 220)", border: "oklch(.29 .012 220)", divider: "oklch(.23 .008 220)", ink: "oklch(.96 0 0)", muted: "oklch(.78 .01 220)", faint: "oklch(.61 .01 220)" },
  white: { canvas: "oklch(.99 0 0)", surface: "oklch(.965 .004 220)", hover: "oklch(.93 .006 220)", raised: "oklch(.985 .002 220)", border: "oklch(.72 .01 220)", divider: "oklch(.84 .008 220)", ink: "oklch(.15 .008 220)", muted: "oklch(.35 .01 220)", faint: "oklch(.48 .01 220)" },
  "light-gray": { canvas: "oklch(.91 .006 220)", surface: "oklch(.95 .005 220)", hover: "oklch(.875 .008 220)", raised: "oklch(.975 .003 220)", border: "oklch(.65 .012 220)", divider: "oklch(.79 .008 220)", ink: "oklch(.16 .008 220)", muted: "oklch(.36 .012 220)", faint: "oklch(.47 .012 220)" },
  "dark-gray": { canvas: "oklch(.16 .006 220)", surface: "oklch(.205 .008 220)", hover: "oklch(.245 .01 220)", raised: "oklch(.27 .01 220)", border: "oklch(.39 .014 220)", divider: "oklch(.32 .01 220)", ink: "oklch(.95 0 0)", muted: "oklch(.76 .01 220)", faint: "oklch(.62 .01 220)" },
  "light-blue": { canvas: "oklch(.91 .025 235)", surface: "oklch(.955 .016 235)", hover: "oklch(.87 .03 235)", raised: "oklch(.98 .01 235)", border: "oklch(.64 .04 235)", divider: "oklch(.79 .025 235)", ink: "oklch(.17 .025 235)", muted: "oklch(.37 .03 235)", faint: "oklch(.48 .03 235)" },
  "light-green": { canvas: "oklch(.91 .025 155)", surface: "oklch(.955 .016 155)", hover: "oklch(.87 .03 155)", raised: "oklch(.98 .01 155)", border: "oklch(.64 .04 155)", divider: "oklch(.79 .025 155)", ink: "oklch(.17 .025 155)", muted: "oklch(.37 .03 155)", faint: "oklch(.48 .03 155)" }
};

function isLightHex(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  return .2126 * r + .7152 * g + .0722 * b > .58;
}

function appSnapshot(state: ReturnType<typeof useAppStore.getState>) {
  return {
    accounts: state.accounts, profiles: state.profiles, threads: state.threads,
    columns: state.columns, rows: state.rows, columnWeights: state.columnWeights, rowWeights: state.rowWeights,
    autoLayout: state.autoLayout, composerSize: state.composerSize, selectedTargets: state.selectedTargets,
    promptHistory: state.promptHistory,
    queue: state.queue.map((item) => ({ ...item, paused: true })), onboardingVisible: state.onboardingVisible,
    managementSection: state.managementSection, promptTemplates: state.promptTemplates,
    sessionHistory: state.sessionHistory, settings: state.settings
  };
}

function appSyncSnapshot(state: ReturnType<typeof useAppStore.getState>) {
  return {
    accounts: state.accounts,
    profiles: state.profiles,
    columns: state.columns,
    rows: state.rows,
    columnWeights: state.columnWeights,
    rowWeights: state.rowWeights,
    autoLayout: state.autoLayout,
    composerSize: state.composerSize,
    selectedTargets: state.selectedTargets,
    onboardingVisible: state.onboardingVisible,
    promptTemplates: state.promptTemplates,
    settings: state.settings
  };
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const settingsWindow = useMemo(
    () => isTauri() ? getCurrentWindow().label === "settings" : params.get("window") === "settings",
    [params]
  );
  const managementOpen = useAppStore((state) => state.managementOpen);
  const settings = useAppStore((state) => state.settings);
  const setManagement = useAppStore((state) => state.setManagement);
  const setModelManagerRoute = useAppStore((state) => state.setModelManagerRoute);
  const updateSettings = useAppStore((state) => state.updateSettings);

  useEffect(() => {
    const section = params.get("section") as ManagementSection | null;
    if (settingsWindow && section) setManagement(true, section);
    if (!isTauri()) return;
    const applyRoute = (route: SettingsRoute) => {
      if (route.section === "models") setModelManagerRoute(route.modelManagerMode, route.modelProfileId);
      else setManagement(true, route.section);
    };
    const unlisten = listen<SettingsRoute>("open-settings-section", (event) => applyRoute(event.payload));
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [params, setManagement, setModelManagerRoute, settingsWindow]);

  useEffect(() => {
    if (settingsWindow && isTauri()) {
      void nativeInvoke<SettingsRoute>("settings_window_ready")
        .then((route) => {
          if (!route) return;
          if (route.section === "models") setModelManagerRoute(route.modelManagerMode, route.modelProfileId);
          else setManagement(true, route.section);
        })
        .catch((error) => console.error("设置窗口初始化失败", error));
    }
  }, [setManagement, setModelManagerRoute, settingsWindow]);

  useEffect(() => {
    if (!isTauri() || settingsWindow) return;
    const unlisten = listen("emergency-visibility-reset", () => updateSettings({ backgroundOpacity: 100, textOpacity: 100 }));
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [settingsWindow, updateSettings]);

  useEffect(() => {
    if (!isTauri() || settingsWindow || !managementOpen) return;
    const section = useAppStore.getState().managementSection;
    const modelManagerMode = useAppStore.getState().modelManagerMode;
    const modelProfileId = useAppStore.getState().modelManagerProfileId;
    setManagement(false, section);
    void nativeInvoke("open_settings_window", { section, modelManagerMode, modelProfileId }).catch((error) => {
      console.error("无法打开设置窗口", error);
      setManagement(true, section);
    });
  }, [managementOpen, setManagement, settingsWindow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "h") { event.preventDefault(); setManagement(true, "history"); }
      if (event.key === "Escape" && (settingsWindow || managementOpen)) {
        if (settingsWindow && isTauri()) void nativeInvoke("hide_settings_window");
        else setManagement(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [managementOpen, setManagement, settingsWindow]);

  useEffect(() => {
    let ready = false;
    let applyingRemote = false;
    let timer: number | undefined;
    let pendingState: ReturnType<typeof useAppStore.getState> | undefined;
    let lastSerialized = "";
    let lastSyncSerialized = "";
    const applySnapshot = (snapshot: Partial<ReturnType<typeof useAppStore.getState>>) => {
      const current = useAppStore.getState();
      const normalized = { ...snapshot, settings: normalizeUiSettings(snapshot.settings ?? current.settings) };
      const profiles = normalized.profiles ?? current.profiles;
      const activeProfiles = profiles.filter((profile) => profile.enabled !== false);
      const sourceThreads = snapshot.threads ?? current.threads;
      normalized.threads = Object.fromEntries(profiles.map((profile) => [
        profile.id,
        sourceThreads[profile.id] ?? createPaneThread(profile.id, normalized.settings.defaultContextEnabled)
      ]));
      normalized.selectedTargets = (normalized.selectedTargets ?? current.selectedTargets)
        .filter((id) => activeProfiles.some((profile) => profile.id === id));
      if ((normalized.columns ?? 0) === 4 && activeProfiles.length <= 1 && normalized.autoLayout) {
        normalized.columns = Math.max(2, activeProfiles.length + 1);
        normalized.columnWeights = normalized.columns === 2 ? [1.15, .85] : Array.from({ length: normalized.columns }, () => 1);
      }
      applyingRemote = true;
      useAppStore.setState(normalized);
      queueMicrotask(() => { applyingRemote = false; });
    };
    const load = async () => {
      try {
        const snapshot = await nativeInvoke<Partial<ReturnType<typeof useAppStore.getState>>>(settingsWindow ? "load_app_sync_snapshot" : "load_app_snapshot");
        if (snapshot && Object.keys(snapshot).length) applySnapshot(snapshot);
        const requestedSection = params.get("section") as ManagementSection | null;
        if (settingsWindow && requestedSection) setManagement(true, requestedSection);
        if (isTauri() && !settingsWindow) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const currentSettings = useAppStore.getState().settings;
          await getCurrentWindow().setAlwaysOnTop(currentSettings.alwaysOnTop);
          await getCurrentWindow().setResizable(!currentSettings.windowLocked);
        }
      } catch (error) {
        console.error("应用状态加载失败，已使用安全默认值继续启动", error);
      } finally {
        const currentState = useAppStore.getState();
        lastSerialized = JSON.stringify(settingsWindow ? appSyncSnapshot(currentState) : appSnapshot(currentState));
        lastSyncSerialized = JSON.stringify(appSyncSnapshot(currentState));
        ready = true;
      }
    };
    void load();
    const remoteListener = isTauri() ? listen<Partial<ReturnType<typeof useAppStore.getState>>>("app-snapshot-updated", (event) => {
      const serialized = JSON.stringify(event.payload);
      if (serialized === lastSyncSerialized) return;
      lastSyncSerialized = serialized;
      if (settingsWindow) lastSerialized = serialized;
      applySnapshot(event.payload);
    }) : Promise.resolve(() => undefined);
    const unsubscribe = useAppStore.subscribe((state) => {
      if (!ready || applyingRemote) return;
      pendingState = state;
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        const currentState = pendingState ?? useAppStore.getState();
        const syncSnapshot = appSyncSnapshot(currentState);
        const snapshot = settingsWindow ? syncSnapshot : appSnapshot(currentState);
        pendingState = undefined;
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        const syncSerialized = JSON.stringify(syncSnapshot);
        const broadcast = syncSerialized !== lastSyncSerialized;
        if (broadcast) lastSyncSerialized = syncSerialized;
        void nativeInvoke("save_app_snapshot", { snapshot, syncSnapshot, broadcast, configurationOnly: settingsWindow }).catch((error) => {
          console.error("应用状态保存失败", error);
        });
      }, 250);
    });
    return () => {
      window.clearTimeout(timer);
      if (pendingState) {
        const syncSnapshot = appSyncSnapshot(pendingState);
        const snapshot = settingsWindow ? syncSnapshot : appSnapshot(pendingState);
        const broadcast = JSON.stringify(syncSnapshot) !== lastSyncSerialized;
        void nativeInvoke("save_app_snapshot", { snapshot, syncSnapshot, broadcast, configurationOnly: settingsWindow }).catch((error) => {
          console.error("应用退出前状态保存失败", error);
        });
      }
      unsubscribe();
      void remoteListener.then((dispose) => dispose());
    };
  }, [params, setManagement, settingsWindow]);

  const customLight = settings.theme === "custom" && isLightHex(settings.customBackgroundColor);
  const lightTheme = settings.theme === "custom" ? customLight : ["white", "light-gray", "light-blue", "light-green"].includes(settings.theme);
  const palette = settings.theme === "custom" ? {
    canvas: settings.customBackgroundColor,
    surface: `color-mix(in oklch, ${settings.customBackgroundColor} 88%, ${customLight ? "white" : "black"})`,
    hover: `color-mix(in oklch, ${settings.customBackgroundColor} 78%, ${customLight ? "black" : "white"})`,
    raised: `color-mix(in oklch, ${settings.customBackgroundColor} 82%, ${customLight ? "white" : "black"})`,
    border: `color-mix(in oklch, ${settings.customBackgroundColor} 58%, ${customLight ? "black" : "white"})`,
    divider: `color-mix(in oklch, ${settings.customBackgroundColor} 74%, ${customLight ? "black" : "white"})`,
    ink: settings.customTextColor,
    muted: `color-mix(in oklch, ${settings.customTextColor} 76%, ${settings.customBackgroundColor})`,
    faint: `color-mix(in oklch, ${settings.customTextColor} 58%, ${settings.customBackgroundColor})`
  } : paletteByTheme[settings.theme];
  const alpha = settingsWindow ? 100 : settings.textOpacity;
  const style = {
    "--canvas": palette.canvas, "--surface": palette.surface, "--surface-hover": palette.hover,
    "--surface-raised": palette.raised, "--border": palette.border, "--divider": palette.divider,
    "--ink": `color-mix(in oklch, ${palette.ink} ${alpha}%, transparent)`,
    "--muted": `color-mix(in oklch, ${palette.muted} ${alpha}%, transparent)`,
    "--faint": `color-mix(in oklch, ${palette.faint} ${alpha}%, transparent)`,
    "--canvas-alpha": settingsWindow ? 1 : settings.backgroundOpacity / 100,
    "--ui-font-size": `${settings.uiFontSize}px`, "--conversation-font-size": `${settings.conversationFontSize}px`,
    "--conversation-line-height": settings.conversationLineHeight, "--message-spacing": `${settings.messageSpacing}px`,
    "--window-radius": `${settings.windowRadius}px`, "--pane-radius": `${settings.paneRadius}px`
  } as React.CSSProperties;

  const showManagement = settingsWindow || (!isTauri() && managementOpen);
  return (
    <div className={`app-shell ${showManagement ? "is-managing is-settings-window" : ""} ${settings.reducedMotion ? "reduce-motion" : ""}`} data-theme={lightTheme ? "light" : "dark"} style={style}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {showManagement ? <Suspense fallback={<div className="management-loading" role="status">正在打开设置…</div>}><ManagementView standalone={settingsWindow} /></Suspense> : <Workspace />}
    </div>
  );
}
