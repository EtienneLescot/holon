import { ToExtensionMessage } from "./protocol";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare function acquireVsCodeApi(): unknown;

export function getVsCodeApi(): VsCodeApi | undefined {
  // In VS Code webview, acquireVsCodeApi exists. In browser dev, it won't.
  const maybe = (typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined) as unknown;
  if (!isVsCodeApi(maybe)) {
    return undefined;
  }
  return maybe;
}

export function postToExtension(message: ToExtensionMessage): void {
  const api = getVsCodeApi();
  if (!api) {
    // Browser mode: no-op.
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
