import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Cdp,
  ariaButton,
  invoke,
  sleep,
  textButton,
  waitFor,
  waitForWindows
} from "./cdp-client.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..", "..");
const framesRoot = path.join(projectRoot, "output", "docs-media");
const assetsRoot = path.join(projectRoot, "docs", "assets");
const backupPath = path.join(projectRoot, ".tooling", "docs-media-app-snapshot.json");

if (!framesRoot.startsWith(projectRoot + path.sep) || path.basename(framesRoot) !== "docs-media") {
  throw new Error("Refusing to clear an unexpected media path");
}
await fs.rm(framesRoot, { recursive: true, force: true });
await fs.mkdir(framesRoot, { recursive: true });
await fs.mkdir(assetsRoot, { recursive: true });
await fs.mkdir(path.dirname(backupPath), { recursive: true });

const frameName = (directory, index) =>
  path.join(directory, `frame-${String(index).padStart(4, "0")}.png`);

async function connectMain() {
  const windows = await waitForWindows((items) => items.main);
  return new Cdp(windows.main).open();
}

async function connectSettings() {
  const windows = await waitForWindows((items) => items.settings);
  return new Cdp(windows.settings).open();
}

function syncSnapshot(snapshot) {
  const {
    accounts, profiles, columns, rows, columnWeights, rowWeights, autoLayout,
    composerSize, selectedTargets, onboardingVisible, promptTemplates, settings
  } = snapshot;
  return {
    accounts, profiles, columns, rows, columnWeights, rowWeights, autoLayout,
    composerSize, selectedTargets, onboardingVisible, promptTemplates, settings
  };
}

async function saveSnapshot(client, snapshot, broadcast = true) {
  const sync = syncSnapshot(snapshot);
  await client.evaluate(invoke("save_app_snapshot", {
    snapshot,
    syncSnapshot: sync,
    broadcast,
    configurationOnly: false
  }));
}

async function reloadMain(client) {
  await client.evaluate("location.reload()");
  await waitFor(
    client,
    `document.querySelectorAll(".conversation-pane").length`,
    (value) => value > 0,
    20_000
  );
  await sleep(700);
}

async function setWindowSize(client, label, width, height) {
  await client.evaluate(invoke("plugin:window|set_size", {
    label,
    value: { Logical: { width, height } }
  }));
  await sleep(420);
}

async function captureHold(client, directory, state, count, delay = 100) {
  await fs.mkdir(directory, { recursive: true });
  for (let offset = 0; offset < count; offset += 1) {
    await client.screenshot(frameName(directory, state.index++));
    await sleep(delay);
  }
}

async function capturePair(main, settings, root, state, count, delay = 100) {
  const mainRoot = path.join(root, "main");
  const settingsRoot = path.join(root, "settings");
  await fs.mkdir(mainRoot, { recursive: true });
  await fs.mkdir(settingsRoot, { recursive: true });
  for (let offset = 0; offset < count; offset += 1) {
    const name = String(state.index++).padStart(4, "0");
    await Promise.all([
      main.screenshot(path.join(mainRoot, `frame-${name}.png`)),
      settings.screenshot(path.join(settingsRoot, `frame-${name}.png`))
    ]);
    await sleep(delay);
  }
}

async function openSection(main, section) {
  await main.evaluate(invoke("open_settings_window", {
    section,
    modelManagerMode: "list",
    modelProfileId: null
  }));
  const settings = await connectSettings();
  await waitFor(
    settings,
    `document.querySelector(".settings-page h2")?.textContent ?? ""`,
    (value) => value.length > 0,
    15_000
  );
  await setWindowSize(settings, "settings", 1080, 760);
  return settings;
}

async function navigate(settings, label) {
  const selector = textButton(label);
  await settings.click(selector);
  await sleep(420);
}

async function setRange(settings, label, value) {
  await settings.evaluate(`(() => {
    const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(260);
}

async function closeSettings(settings) {
  await settings.evaluate(invoke("hide_settings_window"));
  settings.close();
  await sleep(500);
}

let main = await connectMain();
const originalSnapshot = await main.evaluate(invoke("load_app_snapshot"));
await fs.writeFile(backupPath, JSON.stringify(originalSnapshot));

// Keep the public demo on providers that completed cleanly in the preflight run.
// MiniMax is still shown in model management, but its current endpoint closed the
// stream without a completion event and would make the hero capture misleadingly
// look like an AiPin failure.
const activeProfiles = (originalSnapshot.profiles ?? [])
  .filter((profile) => profile.enabled !== false)
  .filter((profile) => !/minimax/i.test(`${profile.displayName ?? ""} ${profile.remoteModelId ?? ""}`))
  .slice(0, 17);
if (!activeProfiles.length) throw new Error("AiPin has no active configured models for real EXE capture");

const activeIds = new Set(activeProfiles.map((profile) => profile.id));
const now = new Date().toISOString();
const demoSnapshot = {
  ...originalSnapshot,
  profiles: (originalSnapshot.profiles ?? []).map((profile) => ({
    ...profile,
    enabled: activeIds.has(profile.id)
  })),
  threads: Object.fromEntries((originalSnapshot.profiles ?? []).map((profile) => {
    const thread = originalSnapshot.threads?.[profile.id] ?? {
      id: `thread-docs-${profile.id}`,
      profileId: profile.id,
      locked: false,
      contextEnabled: false,
      autoScroll: true
    };
    return [profile.id, {
      ...thread,
      status: "idle",
      messages: [],
      locked: false,
      contextEnabled: false,
      autoScroll: true,
      error: undefined,
      lockedSize: undefined
    }];
  })),
  columns: 3,
  rows: 2,
  columnWeights: [1, 1, 1],
  rowWeights: [1, 1],
  autoLayout: false,
  composerSize: "normal",
  composerText: "",
  promptHistory: [],
  selectedTargets: [...activeIds],
  queue: [],
  managementOpen: false,
  managementSection: "models",
  modelManagerMode: "list",
  modelManagerProfileId: undefined,
  onboardingVisible: false,
  promptTemplates: [
    {
      id: "prompt-docs-concise",
      name: "简洁比较",
      content: "请给出清晰、可核查且结构紧凑的回答。",
      enabled: true,
      createdAt: now
    }
  ],
  sessionHistory: [],
  settings: {
    ...originalSnapshot.settings,
    theme: "black",
    backgroundOpacity: 100,
    textOpacity: 100,
    uiFontSize: 14,
    conversationFontSize: 14,
    conversationLineHeight: 1.48,
    messageSpacing: 12,
    windowRadius: 8,
    paneRadius: 6,
    alwaysOnTop: false,
    windowLocked: false,
    reducedMotion: false,
    promptInjectionEnabled: false
  }
};

try {
  await main.evaluate(invoke("plugin:window|set_resizable", { label: "main", value: true }));
  await saveSnapshot(main, demoSnapshot, false);
  await reloadMain(main);
  await setWindowSize(main, "main", 1440, 820);

  const chatDir = path.join(framesRoot, "chat-streaming");
  const chatState = { index: 0 };
  const prompt = "请用 Markdown 简洁解释勾股定理：包含一个公式、一个三列表格、一个 Python 代码示例，并用两条要点总结。总字数控制在 220 字以内。";
  await main.replaceText(`document.querySelector('textarea[aria-label="输入问题"]')`, prompt);
  await captureHold(main, chatDir, chatState, 8, 90);
  await main.press("Enter", "Enter");
  await captureHold(main, chatDir, chatState, 138, 85);
  await waitFor(
    main,
    `document.querySelectorAll(".provider-dot.is-breathing").length`,
    (value) => value === 0,
    120_000
  ).catch(() => undefined);
  await captureHold(main, chatDir, chatState, 18, 90);

  await main.screenshot(path.join(assetsRoot, "workspace-main.png"));
  await main.screenshotElement(
    `document.querySelector(".conversation-pane .message.assistant:last-of-type") || document.querySelector(".conversation-pane")`,
    path.join(assetsRoot, "markdown-math-code.png"),
    8
  );

  const safeSnapshot = await main.evaluate(invoke("load_app_snapshot"));

  const layoutDir = path.join(framesRoot, "layout-workspace");
  const layoutState = { index: 0 };
  await captureHold(main, layoutDir, layoutState, 10, 85);
  await setWindowSize(main, "main", 1080, 760);
  await captureHold(main, layoutDir, layoutState, 12, 85);
  const composerToggle = `[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("切换输入窗大小"))`;
  await main.click(composerToggle);
  await captureHold(main, layoutDir, layoutState, 14, 85);
  await main.click(composerToggle);
  await captureHold(main, layoutDir, layoutState, 14, 85);
  const separator = `document.querySelector('[role="separator"]')`;
  if (await main.evaluate(`Boolean(${separator})`)) {
    await main.drag(separator, 100, 0, 12);
    await captureHold(main, layoutDir, layoutState, 16, 85);
  }
  const firstLock = `document.querySelector(".conversation-pane button[aria-label='锁定窗格']")`;
  if (await main.evaluate(`Boolean(${firstLock})`)) {
    await main.click(firstLock);
    await captureHold(main, layoutDir, layoutState, 14, 85);
  }
  await setWindowSize(main, "main", 1640, 640);
  await captureHold(main, layoutDir, layoutState, 14, 85);
  await main.screenshot(path.join(assetsRoot, "workspace-wide.png"));

  await saveSnapshot(main, safeSnapshot, false);
  await reloadMain(main);
  await setWindowSize(main, "main", 1440, 820);

  let settings = await openSection(main, "models");
  const modelsDir = path.join(framesRoot, "models-and-providers");
  const modelsState = { index: 0 };
  await captureHold(settings, modelsDir, modelsState, 18, 90);
  await settings.screenshot(path.join(assetsRoot, "settings-models.png"));
  const editButton = ariaButton("编辑模型设置");
  if (await settings.evaluate(`Boolean(${editButton})`)) {
    await settings.click(editButton);
    await captureHold(settings, modelsDir, modelsState, 26, 90);
    await settings.screenshot(path.join(assetsRoot, "settings-model-edit.png"));
    const back = textButton("返回模型列表");
    if (await settings.evaluate(`Boolean(${back})`)) {
      await settings.click(back);
      await captureHold(settings, modelsDir, modelsState, 12, 90);
    }
  }

  await navigate(settings, "外观");
  const appearanceRoot = path.join(framesRoot, "appearance-live");
  const appearanceState = { index: 0 };
  await setWindowSize(main, "main", 920, 640);
  await setWindowSize(settings, "settings", 920, 680);
  await capturePair(main, settings, appearanceRoot, appearanceState, 12, 90);
  for (const theme of ["纯白", "浅蓝", "深灰", "浅绿", "纯黑"]) {
    await settings.click(ariaButton(`主题：${theme}`));
    await capturePair(main, settings, appearanceRoot, appearanceState, 10, 90);
  }
  await setRange(settings, "背景透明度", 72);
  await capturePair(main, settings, appearanceRoot, appearanceState, 12, 90);
  await setRange(settings, "背景透明度", 100);
  await setRange(settings, "会话正文字号", 17);
  await setRange(settings, "正文行间距", 1.68);
  await setRange(settings, "小窗格圆角", 18);
  await capturePair(main, settings, appearanceRoot, appearanceState, 16, 90);
  await settings.screenshot(path.join(assetsRoot, "settings-appearance.png"));

  await navigate(settings, "布局");
  await settings.screenshot(path.join(assetsRoot, "settings-layout.png"));

  // Persist the same safe demo conversation as a temporary archive. This avoids
  // racing the confirmation dialog across two WebViews and guarantees that the
  // history screenshot is the real settings window rendering a real archive.
  const demoArchive = {
    id: `session-docs-${Date.now()}`,
    title: "多个模型如何解释勾股定理",
    createdAt: new Date().toISOString(),
    profiles: activeProfiles,
    threads: safeSnapshot.threads,
    layout: {
      columns: safeSnapshot.columns,
      rows: safeSnapshot.rows,
      columnWeights: safeSnapshot.columnWeights,
      rowWeights: safeSnapshot.rowWeights,
      autoLayout: safeSnapshot.autoLayout,
      composerSize: safeSnapshot.composerSize
    }
  };
  await saveSnapshot(main, {
    ...safeSnapshot,
    sessionHistory: [demoArchive]
  }, true);
  // Session archives are intentionally not part of the lightweight cross-window
  // appearance sync payload. Reload the real settings WebView so it reads the
  // freshly persisted archive from SQLite before the history capture.
  await settings.evaluate("location.reload()");
  await waitFor(
    settings,
    `document.querySelector(".settings-page h2")?.textContent ?? ""`,
    (value) => value.length > 0,
    15_000
  );
  await sleep(500);

  const historyDir = path.join(framesRoot, "history-and-data");
  const historyState = { index: 0 };
  await navigate(settings, "会话历史");
  await captureHold(settings, historyDir, historyState, 24, 90);
  await settings.screenshot(path.join(assetsRoot, "settings-history.png"));
  await navigate(settings, "提示词注入");
  await captureHold(settings, historyDir, historyState, 18, 90);
  await navigate(settings, "数据与隐私");
  await captureHold(settings, historyDir, historyState, 28, 90);
  await settings.screenshot(path.join(assetsRoot, "settings-data-transfer.png"));

  await closeSettings(settings);
} finally {
  try {
    main.close();
    main = await connectMain();
    await saveSnapshot(main, originalSnapshot, true);
    await reloadMain(main);
    await main.evaluate(invoke("plugin:window|set_resizable", {
      label: "main",
      value: !originalSnapshot.settings?.windowLocked
    }));
    await main.evaluate(invoke("plugin:window|set_always_on_top", {
      label: "main",
      value: Boolean(originalSnapshot.settings?.alwaysOnTop)
    }));
  } finally {
    main.close();
    await fs.rm(backupPath, { force: true });
  }
}

console.log(JSON.stringify({
  source: "real AiPin.exe via tauri.localhost WebView2",
  activeModelCount: activeProfiles.length,
  framesRoot,
  assetsRoot
}, null, 2));
