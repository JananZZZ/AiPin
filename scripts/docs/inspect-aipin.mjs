import { Cdp, identifyWindows } from "./cdp-client.mjs";

const windows = await identifyWindows();
const summary = {};
for (const [kind, target] of Object.entries(windows)) {
  const client = await new Cdp(target).open();
  summary[kind] = await client.evaluate(`(async () => {
    const sync = await window.__TAURI_INTERNALS__.invoke("load_app_sync_snapshot");
    return ({
    width: innerWidth,
    height: innerHeight,
    conversationPanes: document.querySelectorAll(".conversation-pane").length,
    emptyPanes: document.querySelectorAll(".empty-pane").length,
    panes: [...document.querySelectorAll(".conversation-pane")].map((pane) => ({
      label: pane.getAttribute("aria-label"),
      status: pane.querySelector(".provider-dot")?.getAttribute("aria-label")
    })),
    settingsHeading: document.querySelector(".settings-page h2")?.textContent ?? null,
    configuredAccounts: (sync.accounts ?? []).map((account) => ({
      alias: account.alias,
      provider: account.presetId,
      secretConfigured: account.secretConfigured
    })),
    selectedTargetCount: (sync.selectedTargets ?? []).length,
    buttons: [...document.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label") || button.textContent.trim()
    ).filter(Boolean).slice(0, 80)
  }); })()`);
  client.close();
}
console.log(JSON.stringify(summary, null, 2));
