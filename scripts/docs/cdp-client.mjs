import fs from "node:fs/promises";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listTargets(port = process.env.CDP_PORT ?? "9222") {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return (await response.json()).filter((target) => target.type === "page");
}

export class Cdp {
  constructor(target) {
    this.target = target;
    this.id = 0;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error || message.result?.exceptionDetails) pending.reject(new Error(JSON.stringify(message)));
      else pending.resolve(message.result);
    });
    return this;
  }

  close() {
    this.socket?.close();
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 40_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return result.result?.value;
  }

  async point(expression) {
    return this.evaluate(`(() => {
      const element = ${expression};
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x, y,
        disabled: Boolean(element.disabled),
        hit: hit === element || element.contains(hit)
      };
    })()`);
  }

  async move(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  async click(expression) {
    const point = await this.point(expression);
    if (!point || point.disabled || !point.hit) throw new Error(`Unavailable click target: ${expression}`);
    await this.move(point.x, point.y);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1
    });
    await sleep(180);
  }

  async drag(expression, dx, dy, steps = 8) {
    const point = await this.point(expression);
    if (!point || point.disabled || !point.hit) throw new Error(`Unavailable drag target: ${expression}`);
    await this.move(point.x, point.y);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1
    });
    for (let step = 1; step <= steps; step += 1) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x + dx * step / steps,
        y: point.y + dy * step / steps,
        button: "left",
        buttons: 1
      });
      await sleep(35);
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x + dx, y: point.y + dy, button: "left", buttons: 0
    });
    await sleep(200);
  }

  async replaceText(expression, text) {
    await this.click(expression);
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
    await this.send("Input.insertText", { text });
  }

  async press(key, code = key, modifiers = 0) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  }

  async screenshot(file) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(result.data, "base64"));
  }

  async screenshotElement(expression, file, padding = 0) {
    const rect = await this.evaluate(`(() => {
      const element = ${expression};
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    })()`);
    if (!rect) throw new Error(`Missing screenshot element: ${expression}`);
    const clip = {
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: Math.min(await this.evaluate("innerWidth"), rect.width + padding * 2),
      height: Math.min(await this.evaluate("innerHeight"), rect.height + padding * 2),
      scale: 1
    };
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip
    });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(result.data, "base64"));
  }
}

export async function identifyWindows(port = process.env.CDP_PORT ?? "9222") {
  const result = {};
  for (const target of await listTargets(port)) {
    const client = await new Cdp(target).open();
    const kind = await client.evaluate(
      `document.querySelector(".is-settings-window") ? "settings" :
       document.querySelector(".workspace") ? "main" : "unknown"`
    );
    client.close();
    if (kind !== "unknown") result[kind] = target;
  }
  return result;
}

export async function waitForWindows(predicate, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const windows = await identifyWindows();
    if (predicate(windows)) return windows;
    await sleep(150);
  }
  throw new Error("Timed out waiting for AiPin windows");
}

export async function waitFor(client, expression, predicate, timeout = 30_000) {
  const started = Date.now();
  let value;
  while (Date.now() - started < timeout) {
    value = await client.evaluate(expression);
    if (predicate(value)) return value;
    await sleep(180);
  }
  throw new Error(`Timed out waiting for state; last value: ${JSON.stringify(value)}`);
}

export const ariaButton = (label) =>
  `document.querySelector('button[aria-label=${JSON.stringify(label)}]')`;

export const textButton = (label) =>
  `[...document.querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(label)})`;

export const invoke = (command, args = {}) =>
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`;
