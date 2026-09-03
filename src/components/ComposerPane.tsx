import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ImagePlus,
  ListOrdered,
  Pause,
  Send,
  Trash2,
  Users,
  X
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { ComposerSize } from "../types";
import { IconButton } from "./IconButton";

interface ComposerPaneProps {
  onSend: (text: string, files: File[]) => Promise<void>;
  onStop: () => void;
  running: boolean;
  resizeBlocked?: boolean;
}

const nextSize: Record<ComposerSize, ComposerSize> = { compact: "normal", normal: "expanded", expanded: "compact" };
const sizeName: Record<ComposerSize, string> = { compact: "小", normal: "中", expanded: "大" };

export function ComposerPane({ onSend, onStop, running, resizeBlocked = false }: ComposerPaneProps) {
  const configuredProfiles = useAppStore((state) => state.profiles);
  const profiles = useMemo(() => configuredProfiles.filter((profile) => profile.enabled !== false), [configuredProfiles]);
  const text = useAppStore((state) => state.composerText);
  const setText = useAppStore((state) => state.setComposerText);
  const promptHistory = useAppStore((state) => state.promptHistory);
  const recordPrompt = useAppStore((state) => state.recordPrompt);
  const selectedTargets = useAppStore((state) => state.selectedTargets);
  const toggleTarget = useAppStore((state) => state.toggleTarget);
  const selectAllTargets = useAppStore((state) => state.selectAllTargets);
  const queue = useAppStore((state) => state.queue);
  const dequeue = useAppStore((state) => state.dequeue);
  const reorderQueue = useAppStore((state) => state.reorderQueue);
  const setQueuePaused = useAppStore((state) => state.setQueuePaused);
  const size = useAppStore((state) => state.composerSize);
  const setSize = useAppStore((state) => state.setComposerSize);
  const [files, setFiles] = useState<File[]>([]);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number>();
  const [historyBrowsing, setHistoryBrowsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const acceptFiles = (incoming: File[]) => {
    const valid = incoming.filter((file) => /image\/(png|jpeg|webp)/.test(file.type) && file.size <= 20 * 1024 * 1024);
    if (valid.length !== incoming.length) setAttachmentError("仅支持 PNG、JPEG、WebP，且单张不能超过 20MiB。");
    else setAttachmentError(undefined);
    setFiles((current) => [...current, ...valid].slice(0, 8));
  };

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || profiles.length === 0 || selectedTargets.length === 0) return;
    const outgoingFiles = files;
    recordPrompt(prompt);
    setText("");
    setFiles([]);
    setHistoryIndex(undefined);
    setHistoryBrowsing(false);
    setSubmitting(true);
    setAttachmentError(undefined);
    try {
      await onSend(prompt, outgoingFiles);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const cycleSize = () => {
    const requested = nextSize[size];
    if (requested === "expanded" && resizeBlocked) {
      setAttachmentError("锁定窗格或当前最小尺寸限制了输入窗扩展。");
      return;
    }
    setAttachmentError(undefined);
    setSize(requested);
  };

  const browseHistory = (direction: -1 | 1) => {
    setHistoryBrowsing(true);
    if (!promptHistory.length) return;
    if (historyIndex == null && direction === 1) return;
    const next = historyIndex == null
      ? promptHistory.length - 1
      : Math.max(0, Math.min(promptHistory.length, historyIndex + direction));
    if (next >= promptHistory.length) {
      setHistoryIndex(undefined);
      setText("");
      return;
    }
    setHistoryIndex(next);
    setText(promptHistory[next]);
  };

  return (
    <section className={`pane composer-pane composer-${size}`} aria-label="统一输入窗">
      <header className="pane-header composer-header" onDoubleClick={cycleSize}>
        <button type="button" className="target-summary" onClick={() => setTargetsOpen(true)}>
          <Users size={16} strokeWidth={1.5} />
          <span>{profiles.length === 0 ? "询问全部" : selectedTargets.length === profiles.length ? "询问全部" : `已选 ${selectedTargets.length} 个模型`}</span>
        </button>
        <div className="composer-header-actions">
          <button type="button" className={`queue-count ${queue.length ? "has-items" : ""}`} onClick={() => setQueueOpen(true)}>
            队列 {queue.length}
          </button>
          <IconButton label={`切换输入窗大小（当前${sizeName[size]}）`} onClick={cycleSize}><ChevronsUpDown size={15} /></IconButton>
        </div>
      </header>

      <div className="composer-body">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setHistoryIndex(undefined);
            setHistoryBrowsing(false);
          }}
          onKeyDown={(event) => {
            if ((event.key === "ArrowUp" || event.key === "ArrowDown") && (!text || historyBrowsing)) {
              event.preventDefault();
              browseHistory(event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length) acceptFiles(pasted);
          }}
          onDrop={(event) => {
            event.preventDefault();
            acceptFiles(Array.from(event.dataTransfer.files));
          }}
          onDragOver={(event) => event.preventDefault()}
          placeholder={profiles.length ? historyBrowsing ? "通过 ↑↓ 键，调取历史指令…" : "输入一次，同时询问多个模型…" : "先添加至少一个模型"}
          disabled={profiles.length === 0}
          aria-label="输入问题"
        />
        {files.length > 0 ? (
          <div className="attachment-strip" aria-label="待发送图片">
            {files.map((file, index) => (
              <div className="attachment-chip" key={`${file.name}-${file.lastModified}`}>
                <ImagePlus size={13} />
                <span title={file.name}>{file.name}</span>
                <IconButton label={`移除 ${file.name}`} className="attachment-remove" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        ) : null}
        {attachmentError ? <div className="composer-error" role="alert">{attachmentError}</div> : null}
        {resizeBlocked && size !== "expanded" ? <div className="composer-constraint-note" role="status">锁定窗格限制了输入窗扩展</div> : null}
        <div className="composer-controls">
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => acceptFiles(Array.from(event.currentTarget.files ?? []))}
          />
          <IconButton label="添加图片" disabled={profiles.length === 0 || files.length >= 8} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={17} />
          </IconButton>
          <span className="send-hint">Enter 发送 · Shift+Enter 换行 · Ctrl+C 停止</span>
          <IconButton
            label={running ? "停止当前批次" : "发送到所选模型"}
            className={`send-button ${running ? "is-stopping" : ""}`}
            onClick={() => running ? onStop() : void submit()}
            disabled={!running && (submitting || !text.trim() || profiles.length === 0 || selectedTargets.length === 0)}
          >
            {running ? <Pause size={18} fill="currentColor" /> : <Send size={18} fill="currentColor" />}
          </IconButton>
        </div>
      </div>

      {targetsOpen ? (
        <div className="popover-backdrop" role="presentation" onMouseDown={() => setTargetsOpen(false)}>
          <section className="fixed-popover target-popover" role="dialog" aria-modal="true" aria-label="选择目标模型" onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>本次发送目标</strong><IconButton label="关闭目标选择" onClick={() => setTargetsOpen(false)}><X size={16} /></IconButton></header>
            <button type="button" className="select-all" onClick={selectAllTargets}>选择全部模型</button>
            <div className="target-list">
              {profiles.map((profile) => (
                <label key={profile.id}>
                  <input type="checkbox" checked={selectedTargets.includes(profile.id)} onChange={() => toggleTarget(profile.id)} />
                  <span className="provider-dot" style={{ background: profile.color }} />
                  <span>{profile.providerName}</span>
                  <small>{profile.displayName}</small>
                </label>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {queueOpen ? (
        <div className="popover-backdrop" role="presentation" onMouseDown={() => setQueueOpen(false)}>
          <section className="fixed-popover queue-popover" role="dialog" aria-modal="true" aria-label="发送队列" onMouseDown={(event) => event.stopPropagation()}>
            <header><strong><ListOrdered size={16} /> 发送队列</strong><IconButton label="关闭发送队列" onClick={() => setQueueOpen(false)}><X size={16} /></IconButton></header>
            {queue.length === 0 ? <p className="popover-empty">当前没有等待中的输入</p> : (
              <ol>
                {queue.map((item, index) => (
                  <li key={item.id}>
                    <div><span>{item.text}</span><small>{item.targetIds.length} 个目标 · {item.paused ? "已暂停" : "等待发送"}</small></div>
                    <IconButton label={item.paused ? "恢复队列项" : "暂停队列项"} onClick={() => setQueuePaused(item.id, !item.paused)}>{item.paused ? <Send size={14} /> : <ListOrdered size={14} />}</IconButton>
                    <IconButton label="上移" disabled={index === 0} onClick={() => reorderQueue(item.id, -1)}><ArrowUp size={14} /></IconButton>
                    <IconButton label="下移" disabled={index === queue.length - 1} onClick={() => reorderQueue(item.id, 1)}><ArrowDown size={14} /></IconButton>
                    <IconButton label="删除队列项" danger onClick={() => dequeue(item.id)}><Trash2 size={14} /></IconButton>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
