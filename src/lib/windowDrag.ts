import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./platform";

interface WindowDragEvent {
  button: number;
  pointerId: number;
  screenX: number;
  screenY: number;
  target: EventTarget;
  currentTarget: HTMLElement;
  preventDefault: () => void;
}

let stopActiveDrag: (() => void) | undefined;

/** Deterministic pointer-captured dragging avoids WebView2 native/manual races. */
export function beginWindowDrag(event: WindowDragEvent) {
  if (event.button !== 0 || !isTauri()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, input, select, textarea, a, [role='button'], [data-no-window-drag]")) return;
  event.preventDefault();
  stopActiveDrag?.();

  const appWindow = getCurrentWindow();
  const owner = event.currentTarget;
  const pointerId = event.pointerId;
  const pointerStart = { x: event.screenX, y: event.screenY };
  let latest = pointerStart;
  let windowStart: { x: number; y: number } | undefined;
  let scaleFactor = 1;
  let frame: number | undefined;
  let finished = false;

  try { owner.setPointerCapture(pointerId); } catch { /* window can be tearing down */ }

  const flush = () => {
    frame = undefined;
    if (!windowStart || finished) return;
    const x = windowStart.x + (latest.x - pointerStart.x) * scaleFactor;
    const y = windowStart.y + (latest.y - pointerStart.y) * scaleFactor;
    void appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  };
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    latest = { x: moveEvent.screenX, y: moveEvent.screenY };
    if (frame == null) frame = requestAnimationFrame(flush);
  };
  const finish = (finishEvent?: PointerEvent) => {
    if (finishEvent && finishEvent.pointerId !== pointerId) return;
    if (finished) return;
    if (frame != null) cancelAnimationFrame(frame);
    if (windowStart) {
      const x = windowStart.x + (latest.x - pointerStart.x) * scaleFactor;
      const y = windowStart.y + (latest.y - pointerStart.y) * scaleFactor;
      void appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    }
    finished = true;
    try { if (owner.hasPointerCapture(pointerId)) owner.releasePointerCapture(pointerId); } catch { /* already released */ }
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("blur", finishOnBlur);
    if (stopActiveDrag === finish) stopActiveDrag = undefined;
  };
  const finishOnBlur = () => finish();

  stopActiveDrag = finish;
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
  window.addEventListener("blur", finishOnBlur, { once: true });

  void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
    .then(([position, factor]) => {
      if (finished) return;
      windowStart = position;
      scaleFactor = factor;
      if (latest.x !== pointerStart.x || latest.y !== pointerStart.y) flush();
    })
    .catch((error) => {
      finish();
      console.error("窗口拖动失败", error);
    });
}
