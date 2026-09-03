import { getCurrentWindow } from "@tauri-apps/api/window";
import { History, LayoutGrid, Lock, LockOpen, Maximize2, Minus, Pin, RotateCcw, Settings, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore } from "../store";
import { cancelChat, isTauri, nativeInvoke } from "../lib/platform";
import { beginWindowDrag } from "../lib/windowDrag";
import { IconButton } from "./IconButton";
import { NewConversationDialog } from "./NewConversationDialog";

export function WindowRail() {
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setManagement = useAppStore((state) => state.setManagement);
  const activeSignature = useAppStore((state) => Object.values(state.threads)
    .filter((thread) => ["connecting", "reasoning", "streaming"].includes(thread.status))
    .map((thread) => thread.profileId)
    .join("|"));
  const clearAllThreads = useAppStore((state) => state.clearAllThreads);
  const setPaneStatus = useAppStore((state) => state.setPaneStatus);
  const activeThreads = Object.values(useAppStore.getState().threads)
    .filter((thread) => activeSignature.split("|").includes(thread.profileId));

  const withWindow = async (action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) => {
    if (!isTauri()) return;
    await action(getCurrentWindow());
  };
  const startWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (settings.windowLocked) return;
    beginWindowDrag(event);
  };

  useEffect(() => {
    const reveal = (next: boolean) => {
      if (revealedRef.current === next) return;
      revealedRef.current = next;
      setRevealed(next);
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".window-rail")) { reveal(true); return; }

      const triggerWidth = Math.min(700, Math.max(0, window.innerWidth - 12));
      const withinHorizontalTrigger = Math.abs(event.clientX - window.innerWidth / 2) <= triggerWidth / 2;
      // The top twelve pixels are always a safe reveal strip. The larger 32px
      // proximity zone is available over non-interactive content, but never
      // steals pointer input from pane headers or their controls.
      const overPaneHeader = Boolean(target?.closest(".pane-header"));
      const withinVerticalTrigger = event.clientY <= 12 || (event.clientY <= 32 && !overPaneHeader);
      reveal(withinHorizontalTrigger && withinVerticalTrigger);
    };
    const onWindowBlur = () => reveal(false);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  const closeAfterFocusLeaves = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    revealedRef.current = false;
    setRevealed(false);
  };
  return (
    <div className={`window-rail-zone ${revealed ? "is-open" : ""}`} onFocusCapture={() => { revealedRef.current = true; setRevealed(true); }} onBlurCapture={closeAfterFocusLeaves}>
    <div className="window-rail" role="toolbar" aria-label="窗口控制" onPointerDown={startWindowDrag}>
      {!settings.windowLocked ? <div className="rail-drag-surface" aria-hidden="true" /> : null}
      <div className="rail-brand" title={settings.windowLocked ? "主窗口已锁定" : "拖动主窗口"} onDoubleClick={() => { if (!settings.windowLocked) void withWindow((window) => window.toggleMaximize()); }}>
        <img className="brand-logo" src="/icon.svg" alt="" />
        <span>AiPin</span>
      </div>
      <div className="rail-spacer" aria-hidden="true" />
      <IconButton label="历史" onClick={() => setManagement(true, "history")}><History size={15} /></IconButton>
      <IconButton label="布局" onClick={() => setManagement(true, "layout")}><LayoutGrid size={15} /></IconButton>
      {activeThreads.length ? <IconButton label="停止当前批次" onClick={() => {
        for (const thread of activeThreads) { void cancelChat(thread.profileId); setPaneStatus(thread.profileId, "stopped"); }
      }}><Square size={13} fill="currentColor" /></IconButton> : null}
      <IconButton label="全局新建会话" onClick={async () => {
        const hasMessages = Object.values(useAppStore.getState().threads).some((thread) => thread.messages.length);
        if (hasMessages) { setNewConversationOpen(true); return; }
        await Promise.all(activeThreads.map((thread) => cancelChat(thread.profileId)));
        clearAllThreads(false);
      }}><RotateCcw size={15} /></IconButton>
      <IconButton
        label={settings.alwaysOnTop ? "取消置顶" : "置顶"}
        active={settings.alwaysOnTop}
        onClick={async () => {
          const next = !settings.alwaysOnTop;
          try {
            await withWindow(async (window) => {
              await window.setAlwaysOnTop(next);
              updateSettings({ alwaysOnTop: next });
            });
            if (!isTauri()) updateSettings({ alwaysOnTop: next });
          } catch { updateSettings({ alwaysOnTop: !next }); }
        }}
      ><Pin size={15} /></IconButton>
      <IconButton
        label={settings.windowLocked ? "解除主窗锁定" : "锁定主窗"}
        active={settings.windowLocked}
        onClick={async () => {
          const next = !settings.windowLocked;
          try {
            await withWindow((window) => window.setResizable(!next));
            updateSettings({ windowLocked: next });
          } catch { updateSettings({ windowLocked: false }); }
        }}
      >{settings.windowLocked ? <Lock size={14} /> : <LockOpen size={14} />}</IconButton>
      <IconButton label="设置" onClick={() => setManagement(true, "models")}><Settings size={15} /></IconButton>
      <span className="rail-divider" />
      <IconButton label="最小化" onClick={() => withWindow((window) => window.minimize())}><Minus size={15} /></IconButton>
      <IconButton label="最大化或还原" onClick={() => withWindow((window) => window.toggleMaximize())}><Maximize2 size={14} /></IconButton>
      <IconButton label="隐藏到托盘" className="close-control" onClick={async () => {
        if (isTauri()) await nativeInvoke("hide_main_window");
      }}><X size={16} /></IconButton>
    </div>
    {newConversationOpen ? <NewConversationDialog
      scope="all"
      queueAffected={useAppStore.getState().queue.length > 0}
      onCancel={() => setNewConversationOpen(false)}
      onConfirm={async (archive) => {
        setNewConversationOpen(false);
        const active = Object.values(useAppStore.getState().threads)
          .filter((thread) => ["connecting", "reasoning", "streaming"].includes(thread.status));
        active.forEach((thread) => setPaneStatus(thread.profileId, "stopped"));
        void Promise.allSettled(active.map((thread) => cancelChat(thread.profileId)));
        clearAllThreads(archive);
      }}
    /> : null}
    </div>
  );
}
