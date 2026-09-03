import { Info, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposerPane } from "../components/ComposerPane";
import { ConversationPane } from "../components/ConversationPane";
import { EmptyPane } from "../components/EmptyPane";
import { IconButton } from "../components/IconButton";
import { WindowRail } from "../components/WindowRail";
import { createId } from "../lib/id";
import { effectiveThinking, parametersFromProfile, preservesReasoning, sanitizeModelParameters } from "../lib/modelParameters";
import { cancelChat, stageAttachments, streamChat } from "../lib/platform";
import { useAppStore } from "../store";
import type { AttachmentRef, ModelProfile, StreamChatInput, StreamEnvelope } from "../types";

const MATH_OUTPUT_INSTRUCTION = "数学输出格式：统一使用 Markdown 数学。行内公式使用 $...$，独立公式使用 $$...$$，公式内部采用 LaTeX；不要输出 MathML 或 AsciiMath，除非用户明确要求保留原格式。普通 Unicode 数学字符可以直接保留。";

function TrackHandle({
  axis,
  index,
  position,
  disabled,
  onResize
}: {
  axis: "column" | "row";
  index: number;
  position: number;
  disabled: boolean;
  onResize: (axis: "column" | "row", index: number, deltaRatio: number) => void;
}) {
  const start = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`track-handle handle-${axis} ${disabled ? "is-disabled" : ""} ${dragging ? "is-dragging" : ""}`}
      style={axis === "column" ? { left: `${position * 100}%` } : { top: `${position * 100}%` }}
      title={disabled ? "相邻轨道包含锁定窗格" : `调整${axis === "column" ? "列宽" : "行高"}`}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        start.current = axis === "column" ? event.clientX : event.clientY;
      }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
      onPointerCancel={() => setDragging(false)}
      onPointerMove={(event) => {
        if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const current = axis === "column" ? event.clientX : event.clientY;
        const parentSize = axis === "column" ? event.currentTarget.parentElement?.clientWidth : event.currentTarget.parentElement?.clientHeight;
        if (!parentSize) return;
        onResize(axis, index, (current - start.current) / parentSize);
        start.current = current;
      }}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-orientation={axis === "column" ? "vertical" : "horizontal"}
      aria-label={`调整第 ${index + 1} 与第 ${index + 2} ${axis === "column" ? "列" : "行"}`}
      onKeyDown={(event) => {
        if (disabled) return;
        const negative = axis === "column" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
        const positive = axis === "column" ? event.key === "ArrowRight" : event.key === "ArrowDown";
        if (!negative && !positive) return;
        event.preventDefault();
        onResize(axis, index, positive ? .015 : -.015);
      }}
    />
  );
}

export function Workspace() {
  const configuredProfiles = useAppStore((state) => state.profiles);
  const profiles = useMemo(() => configuredProfiles.filter((profile) => profile.enabled !== false), [configuredProfiles]);
  const accounts = useAppStore((state) => state.accounts);
  const lockSignature = useAppStore((state) => profiles.map((profile, index) => {
    const thread = state.threads[profile.id];
    return thread?.locked ? `${index}:${profile.id}:${thread.lockedSize?.width ?? 0}x${thread.lockedSize?.height ?? 0}` : "";
  }).join("|"));
  const columns = useAppStore((state) => state.columns);
  const rows = useAppStore((state) => state.rows);
  const composerSize = useAppStore((state) => state.composerSize);
  const settings = useAppStore((state) => state.settings);
  const promptTemplates = useAppStore((state) => state.promptTemplates);
  const columnWeights = useAppStore((state) => state.columnWeights);
  const rowWeights = useAppStore((state) => state.rowWeights);
  const resizeTrack = useAppStore((state) => state.resizeTrack);
  const fitLockedTracks = useAppStore((state) => state.fitLockedTracks);
  const selectedTargets = useAppStore((state) => state.selectedTargets);
  const openModelManager = useAppStore((state) => state.openModelManager);
  const appendUserMessage = useAppStore((state) => state.appendUserMessage);
  const beginAssistantMessage = useAppStore((state) => state.beginAssistantMessage);
  const appendAssistantDelta = useAppStore((state) => state.appendAssistantDelta);
  const appendReasoningDelta = useAppStore((state) => state.appendReasoningDelta);
  const setPaneStatus = useAppStore((state) => state.setPaneStatus);
  const enqueue = useAppStore((state) => state.enqueue);
  const queue = useAppStore((state) => state.queue);
  const dequeue = useAppStore((state) => state.dequeue);
  const onboardingVisible = useAppStore((state) => state.onboardingVisible);
  const dismissOnboarding = useAppStore((state) => state.dismissOnboarding);
  const batchRunning = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [processing, setProcessing] = useState(false);

  const stopCurrentBatch = useCallback(() => {
    for (const thread of Object.values(useAppStore.getState().threads)) {
      if (["connecting", "reasoning", "streaming"].includes(thread.status)) {
        void cancelChat(thread.profileId);
        setPaneStatus(thread.profileId, "stopped");
      }
    }
  }, [setPaneStatus]);

  const capacity = Math.min(18, Math.max(2, columns * rows));
  const composerSpan = 1;
  const visibleProfiles = profiles.slice(0, capacity - composerSpan);
  const emptyCount = Math.max(0, capacity - visibleProfiles.length - composerSpan);

  const createRequest = useCallback((profile: ModelProfile, text: string): StreamChatInput | undefined => {
    const account = accounts.find((item) => item.id === profile.accountId);
    const thread = useAppStore.getState().threads[profile.id];
    if (!account || !thread) return undefined;
    const activePrompt = settings.promptInjectionEnabled ? promptTemplates.find((item) => item.id === settings.activePromptId) : undefined;
    const injectedText = activePrompt ? `${activePrompt.content}\n\n${text}` : text;
    const parameters = sanitizeModelParameters(profile.provider, profile.remoteModelId, parametersFromProfile(profile), account.protocol);
    const reasoningEnabled = effectiveThinking(profile.provider, profile.remoteModelId, parameters, profile.reasoningEnabled);
    const returnReasoning = preservesReasoning(profile.provider, profile.remoteModelId, parameters);
    const lastUserIndex = thread.messages.reduce((found, message, index) => message.role === "user" ? index : found, -1);
    const currentUser = thread.messages[lastUserIndex];
    const contextMessages = [] as typeof thread.messages;
    if (thread.contextEnabled) {
      for (let index = 0; index < thread.messages.length; index += 1) {
        const message = thread.messages[index];
        if (index === lastUserIndex) { contextMessages.push(message); continue; }
        if (message.role !== "user") continue;
        const answer = thread.messages[index + 1];
        if (answer?.role !== "assistant") continue;
        if (!settings.includeInterruptedInContext && answer.incomplete) { index += 1; continue; }
        contextMessages.push(message, answer);
        index += 1;
      }
    } else if (currentUser) contextMessages.push(currentUser);
    const history: StreamChatInput["messages"] = [{ role: "system", content: MATH_OUTPUT_INSTRUCTION, attachments: [] }, ...contextMessages.map((message) => ({
      role: message.role,
      content: message.id === currentUser?.id ? injectedText : message.blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n"),
      reasoningContent: returnReasoning && message.role === "assistant" ? message.blocks.filter((block) => block.type === "reasoning").map((block) => block.text ?? "").join("\n") || undefined : undefined,
      attachments: message.blocks.filter((block) => block.type === "image" && block.attachmentId).map((block) => ({
        id: block.attachmentId!,
        name: block.name ?? "image",
        mime: (block.mime ?? "image/png") as AttachmentRef["mime"],
        byteSize: block.byteSize ?? 0,
        dataUrl: block.previewUrl
      }))
    }))];
    return {
      paneId: profile.id,
      conversationId: thread.id,
      accountId: account.id,
      profileId: profile.id,
      protocol: account.protocol,
      auth: account.auth,
      baseUrl: account.baseUrl,
      model: profile.remoteModelId,
      messages: history,
      provider: profile.provider,
      reasoningEnabled,
      reasoningEffort: parameters.reasoningEffort ?? profile.reasoningEffort ?? "medium",
      parameters,
      store: false
    };
  }, [accounts, promptTemplates, settings.activePromptId, settings.includeInterruptedInContext, settings.promptInjectionEnabled]);

  const runPrompt = useCallback(async (text: string, targetIds: string[], attachments: AttachmentRef[] = []) => {
    batchRunning.current = true;
    setProcessing(true);
    const targets = profiles.filter((profile) => targetIds.includes(profile.id));
    targets.forEach((profile) => appendUserMessage(profile.id, text, attachments));

    try {
      await Promise.allSettled(targets.map(async (profile) => {
      const assistantMessageId = beginAssistantMessage(profile.id);
      const request = createRequest(profile, text);
      if (!request) {
        setPaneStatus(profile.id, "failed", "模型账号配置缺失或已删除。");
        return;
      }
      setPaneStatus(profile.id, "connecting");
      let textBuffer = "";
      let reasoningBuffer = "";
      let frame: number | undefined;
      const flush = () => {
        frame = undefined;
        if (reasoningBuffer) { appendReasoningDelta(profile.id, assistantMessageId, reasoningBuffer); reasoningBuffer = ""; }
        if (textBuffer) { appendAssistantDelta(profile.id, assistantMessageId, textBuffer); textBuffer = ""; }
      };
      const scheduleFlush = () => { if (frame == null) frame = requestAnimationFrame(flush); };
      const transitionTo = (status: "connecting" | "reasoning" | "streaming") => {
        if (useAppStore.getState().threads[profile.id]?.status !== status) setPaneStatus(profile.id, status);
      };
      const onEvent = (event: StreamEnvelope) => {
        if (useAppStore.getState().threads[profile.id]?.id !== request.conversationId) return;
        // A provider may deliver one final buffered chunk after cancellation. Never let
        // that late chunk revive a pane the user has explicitly stopped.
        if (useAppStore.getState().threads[profile.id]?.status === "stopped") return;
        if (event.kind === "started") transitionTo("connecting");
        if (event.kind === "reasoning_delta" && request.reasoningEnabled) { transitionTo("reasoning"); reasoningBuffer += String(event.payload.delta ?? ""); scheduleFlush(); }
        if (event.kind === "text_delta") {
          transitionTo("streaming");
          textBuffer += String(event.payload.delta ?? "");
          scheduleFlush();
        }
        if (event.kind === "completed") { if (frame != null) cancelAnimationFrame(frame); flush(); setPaneStatus(profile.id, "completed"); }
        if (event.kind === "failed") { if (frame != null) cancelAnimationFrame(frame); flush(); setPaneStatus(profile.id, "failed", String(event.payload.message ?? "请求失败")); }
      };
      try {
        await streamChat(request, onEvent);
      } catch (error) {
        if (frame != null) cancelAnimationFrame(frame);
        flush();
        setPaneStatus(profile.id, "failed", String(error));
      }
      }));
    } finally {
      batchRunning.current = false;
      setProcessing(false);
    }
  }, [appendAssistantDelta, appendReasoningDelta, appendUserMessage, beginAssistantMessage, createRequest, profiles, setPaneStatus]);

  const send = useCallback(async (text: string, files: File[]) => {
    const targetIds = selectedTargets.filter((id) => profiles.some((profile) => profile.id === id));
    if (!targetIds.length) return;
    const attachments = await stageAttachments(files);
    const hasActive = Object.values(useAppStore.getState().threads).some((thread) => ["connecting", "reasoning", "streaming"].includes(thread.status));
    if (hasActive || batchRunning.current) {
      enqueue({ id: createId("queue"), text, targetIds, attachments, createdAt: new Date().toISOString(), paused: settings.queueStrategy === "manual" });
      return;
    }
    await runPrompt(text, targetIds, attachments);
  }, [enqueue, profiles, runPrompt, selectedTargets, settings.queueStrategy]);

  useEffect(() => {
    if (batchRunning.current || processing) return;
    const next = queue.find((item) => !item.paused);
    if (!next) return;
    dequeue(next.id);
    void runPrompt(next.text, next.targetIds, next.attachments);
  }, [dequeue, processing, queue, runPrompt]);

  useEffect(() => {
    const stopAll = (event: KeyboardEvent) => {
      const shortcut = event.ctrlKey && (event.key === "." || event.key.toLowerCase() === "c");
      if (!shortcut) return;
      if (event.key.toLowerCase() === "c") {
        const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : undefined;
        const hasSelectedText = field
          ? field.selectionStart !== field.selectionEnd
          : Boolean(window.getSelection() && !window.getSelection()!.isCollapsed);
        if (hasSelectedText) return;
      }
      const active = Object.values(useAppStore.getState().threads).some((thread) => ["connecting", "reasoning", "streaming"].includes(thread.status));
      if (!active) return;
      event.preventDefault();
      stopCurrentBatch();
    };
    window.addEventListener("keydown", stopAll);
    return () => window.removeEventListener("keydown", stopAll);
  }, [stopCurrentBatch]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => fitLockedTracks(entry.contentRect.width, entry.contentRect.height));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [fitLockedTracks]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const currentThreads = useAppStore.getState().threads;
    const lockedColumns = new Map<number, number>();
    const lockedRows = new Map<number, number>();
    profiles.forEach((profile, index) => {
      const thread = currentThreads[profile.id];
      if (!thread?.locked || !thread.lockedSize) return;
      lockedColumns.set(index % columns, thread.lockedSize.width);
      lockedRows.set(Math.floor(index / columns), thread.lockedSize.height);
    });
    const minWidth = Math.max(320, Array.from(lockedColumns.values()).reduce((sum, value) => sum + value, 0) + (columns - lockedColumns.size) * 92 + (columns - 1) * 4 + 8);
    const minHeight = Math.max(110, Array.from(lockedRows.values()).reduce((sum, value) => sum + value, 0) + (rows - lockedRows.size) * 92 + (rows - 1) * 4 + 8);
    void Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi")]).then(([{ getCurrentWindow }, { LogicalSize }]) => getCurrentWindow().setMinSize(new LogicalSize(minWidth, minHeight)));
  }, [columns, lockSignature, profiles, rows]);

  const normalizedColumns = columnWeights?.length === columns ? columnWeights : Array.from({ length: columns }, () => 1);
  const normalizedRows = rowWeights?.length === rows ? rowWeights : Array.from({ length: rows }, () => 1);
  const lockedProfileIds = useMemo(() => new Set(lockSignature.split("|").filter(Boolean).map((entry) => entry.split(":")[1])), [lockSignature]);
  const lockedColumnIndexes = useMemo(() => new Set(visibleProfiles.flatMap((profile, index) => lockedProfileIds.has(profile.id) ? [index % columns] : [])), [columns, lockedProfileIds, visibleProfiles]);
  const lockedRowIndexes = useMemo(() => new Set(visibleProfiles.flatMap((profile, index) => lockedProfileIds.has(profile.id) ? [Math.floor(index / columns)] : [])), [columns, lockedProfileIds, visibleProfiles]);
  const presentationWeights = useMemo(() => {
    const tune = (weights: number[], locked: Set<number>) => {
      if (weights.length <= 1 || composerSize === "normal") return weights;
      const next = [...weights];
      const target = next.length - 1;
      const neighbour = target - 1;
      if (locked.has(target) || locked.has(neighbour)) return weights;
      const total = next.reduce((sum, value) => sum + value, 0);
      const desired = composerSize === "expanded" ? Math.min(total * .5, next[target] * 1.85) : Math.max(total * .12, next[target] * .72);
      const minNeighbour = Math.max(total * .055, .12);
      const delta = Math.max(-next[target] + .12, Math.min(next[neighbour] - minNeighbour, desired - next[target]));
      next[target] += delta;
      next[neighbour] -= delta;
      return next;
    };
    return { columns: tune(normalizedColumns, lockedColumnIndexes), rows: tune(normalizedRows, lockedRowIndexes) };
  }, [composerSize, lockedColumnIndexes, lockedRowIndexes, normalizedColumns, normalizedRows]);
  const gridStyle = useMemo(() => ({
    "--grid-columns": columns,
    "--grid-rows": rows,
    "--composer-span": composerSpan,
    gridTemplateColumns: presentationWeights.columns.map((value) => `${value}fr`).join(" "),
    gridTemplateRows: presentationWeights.rows.map((value) => `${value}fr`).join(" ")
  }) as React.CSSProperties, [columns, rows, composerSpan, presentationWeights]);

  const lockedTrack = (axis: "column" | "row", trackIndex: number) => visibleProfiles.some((profile, index) => {
    if (!lockedProfileIds.has(profile.id)) return false;
    const coordinate = axis === "column" ? index % columns : Math.floor(index / columns);
    return coordinate === trackIndex;
  });
  const composerResizeBlocked = (columns <= 1 || lockedTrack("column", columns - 1) || lockedTrack("column", columns - 2))
    && (rows <= 1 || lockedTrack("row", rows - 1) || lockedTrack("row", rows - 2));

  const cumulative = (weights: number[], index: number) => weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / weights.reduce((sum, value) => sum + value, 0);

  return (
    <main className="workspace" id="main-content">
      <h1 className="sr-only">AiPin 多模型对比工作区</h1>
      <WindowRail />
      <div ref={gridRef} className="pane-grid" style={gridStyle}>
        {visibleProfiles.map((profile) => <ConversationPane key={profile.id} profile={profile} />)}
        {Array.from({ length: emptyCount }, (_, index) => <EmptyPane key={`empty-${index}`} onAdd={() => openModelManager("add")} />)}
        <ComposerPane onSend={send} onStop={stopCurrentBatch} running={processing} resizeBlocked={composerResizeBlocked} />
        {presentationWeights.columns.slice(0, -1).map((_, index) => <TrackHandle key={`column-handle-${index}`} axis="column" index={index} position={cumulative(presentationWeights.columns, index)} disabled={lockedTrack("column", index) || lockedTrack("column", index + 1)} onResize={resizeTrack} />)}
        {presentationWeights.rows.slice(0, -1).map((_, index) => <TrackHandle key={`row-handle-${index}`} axis="row" index={index} position={cumulative(presentationWeights.rows, index)} disabled={lockedTrack("row", index) || lockedTrack("row", index + 1)} onResize={resizeTrack} />)}
      </div>
      {onboardingVisible ? (
        <div className="onboarding-tip" role="status">
          <Info size={15} />
          <span>添加模型 <b>→</b> 输入问题 <b>→</b> 比较回答</span>
          <IconButton label="关闭首次提示" onClick={dismissOnboarding}><X size={14} /></IconButton>
        </div>
      ) : null}
    </main>
  );
}
