import { useEffect, useRef, useState } from "react";

export function NewConversationDialog({
  scope,
  queueAffected,
  onCancel,
  onConfirm
}: {
  scope: "single" | "all";
  queueAffected: boolean;
  onCancel: () => void;
  onConfirm: (archive: boolean) => void | Promise<void>;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => primaryRef.current?.focus(), []);
  const confirm = async (archive: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(archive); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section
        className="decision-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="new-conversation-title"
        aria-describedby="new-conversation-description"
        onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
      >
        <h2 id="new-conversation-title">{scope === "all" ? "新建全部会话" : "新建当前会话"}</h2>
        <p id="new-conversation-description">当前消息可以保留到会话历史，也可以永久删除。此操作会停止正在生成的回答。</p>
        {queueAffected ? <p className="dialog-note">受影响的队列项会保留，但将切换为暂停状态，不会自动产生费用。</p> : null}
        <div className="decision-actions">
          <button className="subtle-button" disabled={busy} onClick={onCancel}>取消</button>
          <button className="danger-button" disabled={busy} onClick={() => void confirm(false)}>永久删除</button>
          <button ref={primaryRef} className="primary-button" disabled={busy} onClick={() => void confirm(true)}>{busy ? "正在新建…" : "保留到历史"}</button>
        </div>
      </section>
    </div>
  );
}
