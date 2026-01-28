import { ToExtensionMessage } from "./protocol";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare function acquireVsCodeApi(): unknown;

let cachedApi: VsCodeApi | undefined;
let triedAcquire = false;

type BrowserBridge = {
  postMessageFromUi: (message: ToExtensionMessage) => void;
};

let browserBridge: BrowserBridge | undefined;
const pendingMessages: ToExtensionMessage[] = [];

export function registerBrowserBridge(bridge: BrowserBridge): void {
  browserBridge = bridge;
  while (pendingMessages.length > 0) {
    const msg = pendingMessages.shift();
    if (msg) {
      bridge.postMessageFromUi(msg);
    }
  }
}

export function getVsCodeApi(): VsCodeApi | undefined {
  if (cachedApi) {
    return cachedApi;
  }
  if (triedAcquire) {
    return undefined;
  }
  triedAcquire = true;

  // In VS Code webview, acquireVsCodeApi exists. In browser dev, it won't.
  try {
    const maybe = (typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined) as unknown;
    if (!isVsCodeApi(maybe)) {
      return undefined;
    }
    cachedApi = maybe;
    return cachedApi;
  } catch {
    return undefined;
  }
}

export function postToExtension(message: ToExtensionMessage): void {
  const api = getVsCodeApi();
  if (!api) {
    // Browser mode: forward to the dev bridge if present.
    if (browserBridge) {
      browserBridge.postMessageFromUi(message);
    } else {
      pendingMessages.push(message);
    }
    return;
  }
  api.postMessage(message);
}

function isVsCodeApi(value: unknown): value is VsCodeApi {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.postMessage === "function" && typeof v.getState === "function" && typeof v.setState === "function";
}
