import { Channel, invoke } from "@tauri-apps/api/core";
import type { AttachmentRef, StreamChatInput, StreamEnvelope } from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

const browserCancellations = new Set<string>();

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function stageAttachments(files: File[]): Promise<AttachmentRef[]> {
  if (!files.length) return [];
  if (isTauri()) {
    const attachments = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mime: file.type,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
    })));
    return invoke<AttachmentRef[]>("stage_attachments", { attachments });
  }
  return Promise.all(files.map(async (file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type as AttachmentRef["mime"],
    byteSize: file.size,
    dataUrl: await fileToDataUrl(file)
  })));
}

export async function cancelChat(paneId: string): Promise<void> {
  if (isTauri()) await invoke("cancel_request", { paneId });
  else browserCancellations.add(paneId);
}

export async function attachmentPreview(attachmentId: string): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  return invoke<string>("get_attachment_data_url", { attachmentId });
}

export async function streamChat(
  input: StreamChatInput,
  onEvent: (event: StreamEnvelope) => void
): Promise<void> {
  if (isTauri()) {
    const channel = new Channel<StreamEnvelope>();
    channel.onmessage = onEvent;
    await invoke("stream_chat", { input, onEvent: channel });
    return;
  }

  const sample = [
    "浏览器预览模式不会发送真实 API 请求。\n\n",
    "这里展示的是与正式程序相同的流式渲染路径：\n\n",
    "- 每个模型线程彼此隔离\n",
    "- 用户上滚后停止自动追随\n",
    "- Markdown、`代码` 与公式 $E=mc^2$ 可被渲染\n\n",
    "请使用 `npm run tauri dev` 连接真实供应商。"
  ];
  const requestId = crypto.randomUUID();
  browserCancellations.delete(input.paneId);
  onEvent({
    schemaVersion: 1,
    requestId,
    attemptId: crypto.randomUUID(),
    paneId: input.paneId,
    conversationId: input.conversationId,
    sequence: 0,
    timestamp: new Date().toISOString(),
    kind: "started",
    payload: {}
  });
  let sequence = 1;
  if (input.reasoningEnabled) {
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    if (!browserCancellations.has(input.paneId)) {
      onEvent({
        schemaVersion: 1,
        requestId,
        attemptId: requestId,
        paneId: input.paneId,
        conversationId: input.conversationId,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
        kind: "reasoning_delta",
        payload: { delta: "正在梳理问题条件与回答结构。" }
      });
    }
  }
  for (let index = 0; index < sample.length; index += 1) {
    if (browserCancellations.has(input.paneId)) {
      browserCancellations.delete(input.paneId);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    if (browserCancellations.has(input.paneId)) {
      browserCancellations.delete(input.paneId);
      return;
    }
    onEvent({
      schemaVersion: 1,
      requestId,
      attemptId: requestId,
      paneId: input.paneId,
      conversationId: input.conversationId,
      sequence: sequence++,
      timestamp: new Date().toISOString(),
      kind: "text_delta",
      payload: { delta: sample[index] }
    });
  }
  onEvent({
    schemaVersion: 1,
    requestId,
    attemptId: requestId,
    paneId: input.paneId,
    conversationId: input.conversationId,
    sequence,
    timestamp: new Date().toISOString(),
    kind: "completed",
    payload: {}
  });
}

export async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  return invoke<T>(command, args);
}
