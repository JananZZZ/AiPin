import { Circle, Clock3, Link2, Link2Off, Lock, LockOpen, MoreHorizontal, RotateCcw, Square } from "lucide-react";
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore } from "../store";
import { attachmentPreview, cancelChat } from "../lib/platform";
import { effectiveThinking, parametersFromProfile, sanitizeModelParameters } from "../lib/modelParameters";
import type { ContentBlock, Message, ModelProfile, PaneThread } from "../types";
import { IconButton } from "./IconButton";
import { MarkdownMessage } from "./MarkdownMessage";
import { NewConversationDialog } from "./NewConversationDialog";

const statusLabels: Record<PaneThread["status"], string> = {
  idle: "就绪",
  queued: "已排队",
  connecting: "正在连接",
  reasoning: "正在推理",
  streaming: "正在生成",
  completed: "完成",
  stopped: "已停止",
  incomplete: "输出不完整",
  failed: "失败"
};

function MessageImage({ block }: { block: ContentBlock }) {
  const [source, setSource] = useState(block.previewUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (source || !block.attachmentId) return;
    void attachmentPreview(block.attachmentId).then((value) => setSource(value)).catch(() => setFailed(true));
  }, [block.attachmentId, source]);
  if (failed) return <div className="message-image-unavailable">图片预览不可用 · {block.name ?? "附件"}</div>;
  if (!source) return <div className="message-image-loading" role="status">正在载入图片预览…</div>;
  return <a className="message-image" href={source} target="_blank" rel="noreferrer" aria-label={`查看图片 ${block.name ?? "附件"}`}><img src={source} alt={block.name ?? "用户上传的图片"} /></a>;
}

const MessageSegment = memo(function MessageSegment({ message, streaming = false, placeholder }: { message: Message; streaming?: boolean; placeholder?: string }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const reasoning = message.blocks.find((block) => block.type === "reasoning" && block.text);
  const hasVisibleContent = message.blocks.some((block) => (block.type === "text" || block.type === "reasoning") ? Boolean(block.text?.trim()) : block.type === "image");
  return (
    <article className={`message-segment role-${message.role}`}>
      <div className="speaker-label"><span>{message.label}</span>{reasoning ? <button type="button" className="reasoning-toggle" aria-label={reasoningOpen ? "收起思考过程" : "展开思考过程"} aria-expanded={reasoningOpen} title={reasoningOpen ? "收起思考过程" : "展开思考过程"} onClick={() => setReasoningOpen((open) => !open)}><Circle size={9} strokeWidth={2} fill={reasoningOpen ? "currentColor" : "none"} /></button> : null}</div>
      {placeholder && !hasVisibleContent ? <div className="generating-placeholder" role="status" aria-live="polite"><span className="generating-dots" aria-hidden="true"><i /><i /><i /></span><span>{placeholder}</span></div> : null}
      {reasoning && reasoningOpen ? <div className="reasoning-content">{streaming ? <div className="streaming-text">{reasoning.text}</div> : <MarkdownMessage>{reasoning.text ?? ""}</MarkdownMessage>}</div> : null}
      {message.blocks.map((block, index) => block.type === "text"
        ? block.text ? streaming ? <div className="streaming-text" key={index}>{block.text}</div> : <MarkdownMessage key={index}>{block.text}</MarkdownMessage> : null
        : block.type === "reasoning" ? null
        : block.type === "image" ? <MessageImage block={block} key={index} /> : null)}
    </article>
  );
});

export const ConversationPane = memo(function ConversationPane({ profile }: { profile: ModelProfile }) {
  const effectiveReasoning = effectiveThinking(profile.provider, profile.remoteModelId, sanitizeModelParameters(profile.provider, profile.remoteModelId, parametersFromProfile(profile)), profile.reasoningEnabled);
  const thread = useAppStore((state) => state.threads[profile.id]) as PaneThread;
  const togglePaneLock = useAppStore((state) => state.togglePaneLock);
  const toggleContext = useAppStore((state) => state.toggleContext);
  const clearThread = useAppStore((state) => state.clearThread);
  const setManagement = useAppStore((state) => state.setManagement);
  const openModelManager = useAppStore((state) => state.openModelManager);
  const reorderProfiles = useAppStore((state) => state.reorderProfiles);
  const setPaneStatus = useAppStore((state) => state.setPaneStatus);
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneDrag = useRef<{ startX: number; startY: number; active: boolean; target?: HTMLElement }>({ startX: 0, startY: 0, active: false });
  const [density, setDensity] = useState<"normal" | "compact" | "micro">("normal");
  const [following, setFollowing] = useState(true);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [richMessageId, setRichMessageId] = useState<string>();
  const active = ["queued", "connecting", "reasoning", "streaming"].includes(thread.status);

  useEffect(() => {
    if (!rootRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDensity((current) => {
        if (current === "micro" && width >= 176 && height >= 104) return "compact";
        if (current === "compact" && width >= 276 && height >= 174) return "normal";
        if (width < 160 || height < 92) return "micro";
        if (width < 260 || height < 160) return "compact";
        return current === "micro" ? "compact" : "normal";
      });
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!following || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.messages, following]);

  useEffect(() => {
    if (["connecting", "reasoning", "streaming"].includes(thread.status)) {
      setRichMessageId(undefined);
      return;
    }
    const latest = thread.messages.at(-1);
    if (!latest || latest.role !== "assistant") return;
    // Do not make 17 panes parse Markdown/KaTeX in the same frame. The short,
    // deterministic stagger is visually imperceptible but avoids a completion
    // spike after a large comparison batch.
    const offset = 20 + [...profile.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 140;
    const timer = window.setTimeout(() => setRichMessageId(latest.id), offset);
    return () => window.clearTimeout(timer);
  }, [profile.id, thread.messages, thread.status]);

  useEffect(() => () => {
    document.body.classList.remove("pane-reordering");
    document.querySelectorAll(".pane-drop-target").forEach((element) => element.classList.remove("pane-drop-target"));
  }, []);

  const finishPaneDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const state = paneDrag.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rootRef.current?.classList.remove("is-pane-dragging");
    document.body.classList.remove("pane-reordering");
    state.target?.classList.remove("pane-drop-target");
    const targetId = state.active ? state.target?.dataset.profileId : undefined;
    paneDrag.current = { startX: 0, startY: 0, active: false };
    if (targetId) reorderProfiles(profile.id, targetId);
  };

  return (
    <section ref={rootRef} data-profile-id={profile.id} className={`pane conversation-pane density-${density}`} aria-label={`${profile.providerName} ${profile.displayName} 会话`}>
      <header className="pane-header">
        <div
          className="pane-drag-handle pane-identity"
          title={thread.locked ? "窗格已锁定" : `${profile.providerName} · ${profile.displayName} · 拖动调整顺序`}
          onPointerDown={(event) => {
            if (thread.locked || event.button !== 0) return;
            paneDrag.current = { startX: event.clientX, startY: event.clientY, active: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const state = paneDrag.current;
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (!state.active && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;
            if (!state.active) {
              state.active = true;
              rootRef.current?.classList.add("is-pane-dragging");
              document.body.classList.add("pane-reordering");
            }
            event.preventDefault();
            const candidate = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-profile-id]");
            const candidateId = candidate?.dataset.profileId;
            const candidateLocked = candidateId ? useAppStore.getState().threads[candidateId]?.locked : true;
            const next = candidate && candidateId !== profile.id && !candidateLocked ? candidate : undefined;
            if (next === state.target) return;
            state.target?.classList.remove("pane-drop-target");
            state.target = next;
            state.target?.classList.add("pane-drop-target");
          }}
          onPointerUp={finishPaneDrag}
          onPointerCancel={finishPaneDrag}
        >
          <span className={`provider-dot ${active ? "is-breathing" : ""}`} style={{ background: profile.color, color: profile.color }} role="status" aria-label={statusLabels[thread.status]} />
          <span className="provider-name">{profile.providerName}</span>
          <span className="model-name">{profile.displayName}</span>
        </div>
        <div className="pane-actions">
          {thread.status === "streaming" || thread.status === "connecting" || thread.status === "reasoning" ? (
            <IconButton label="停止生成" onClick={async () => {
              await cancelChat(profile.id);
              setPaneStatus(profile.id, "stopped");
            }}><Square size={14} fill="currentColor" /></IconButton>
          ) : null}
          <IconButton label={thread.contextEnabled ? "关闭上下文" : "开启上下文"} active={thread.contextEnabled} onClick={() => toggleContext(profile.id)}>
            {thread.contextEnabled ? <Link2 size={15} /> : <Link2Off size={15} />}
          </IconButton>
          <IconButton label="新建会话" onClick={async () => {
            if (thread.messages.length) { setNewConversationOpen(true); return; }
            if (["connecting", "reasoning", "streaming"].includes(thread.status)) await cancelChat(profile.id);
            clearThread(profile.id, false);
          }}><RotateCcw size={15} /></IconButton>
          <IconButton label={thread.locked ? "解除窗格锁定" : "锁定窗格"} active={thread.locked} onClick={() => {
            const rect = rootRef.current?.getBoundingClientRect();
            togglePaneLock(profile.id, rect ? { width: rect.width, height: rect.height } : undefined);
          }}>
            {thread.locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </IconButton>
          <IconButton label="最近历史" onClick={() => setManagement(true, "history")}><Clock3 size={15} /></IconButton>
          <IconButton label="模型设置" onClick={() => openModelManager("edit", profile.id)}><MoreHorizontal size={16} /></IconButton>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="message-scroll"
        onScroll={(event) => {
          const target = event.currentTarget;
          const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 28;
          setFollowing(nearBottom);
        }}
      >
        {thread.messages.length === 0 ? (
          <div className="pane-empty-copy">
            <p>等待提问</p>
            <span>{thread.contextEnabled ? "上下文已开启" : "本次只发送当前输入"}</span>
          </div>
        ) : (
          thread.messages.map((message, index) => {
            const latestAssistant = index === thread.messages.length - 1 && message.role === "assistant";
            return <MessageSegment
              key={message.id}
              message={message}
              streaming={latestAssistant && (["connecting", "reasoning", "streaming"].includes(thread.status) || richMessageId !== message.id)}
              placeholder={latestAssistant && ["connecting", "reasoning", "streaming"].includes(thread.status) ? (effectiveReasoning ? "深度思考中..." : "模型正在生成中...") : undefined}
            />;
          })
        )}
        {thread.error ? <div className="inline-error" role="alert">{thread.error}</div> : null}
      </div>

      {!following && (thread.status === "streaming" || thread.status === "reasoning") ? (
        <button type="button" className="new-content" onClick={() => setFollowing(true)}>有新内容 ↓</button>
      ) : null}
      {newConversationOpen ? <NewConversationDialog
        scope="single"
        queueAffected={useAppStore.getState().queue.some((item) => item.targetIds.includes(profile.id))}
        onCancel={() => setNewConversationOpen(false)}
        onConfirm={async (archive) => {
          if (["connecting", "reasoning", "streaming"].includes(useAppStore.getState().threads[profile.id]?.status)) await cancelChat(profile.id);
          clearThread(profile.id, archive);
          setNewConversationOpen(false);
        }}
      /> : null}
    </section>
  );
});
