import {
  NATIVE_BRIDGE_NAME,
  NATIVE_BRIDGE_VERSION,
  NativeBridgeCommand,
  NativeBridgeEnvelope,
  NativeBridgeRequest,
} from "@/services/nativeBridge/protocol";

type WebViewWindow = Window & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
  __BOP_NATIVE_SHELL__?: {
    bridge: typeof NATIVE_BRIDGE_NAME;
    version: typeof NATIVE_BRIDGE_VERSION;
    platform: "android";
  };
};

type EventListener = (payload: unknown) => void;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class NativeBridgeClient {
  private pending = new Map<string, PendingRequest>();
  private listeners = new Map<string, Set<EventListener>>();
  private installed = false;

  isAvailable() {
    if (typeof window === "undefined") return false;
    const shellWindow = window as WebViewWindow;
    const transportAvailable =
      typeof shellWindow.ReactNativeWebView?.postMessage === "function";
    const declaredVersion = shellWindow.__BOP_NATIVE_SHELL__?.version;
    const nativeShellUserAgent =
      typeof navigator !== "undefined" &&
      /(?:^|\s)BOP-HRMS-Android\/1(?:\s|$)/.test(navigator.userAgent);
    // Some Android WebView versions install the postMessage transport before
    // injectedJavaScriptBeforeContentLoaded has published the metadata flag.
    // The shell-specific user agent is a second, versioned attestation supplied
    // by AndroidHrmsShell; an ordinary browser/PWA still cannot pass this check.
    return (
      transportAvailable &&
      (declaredVersion === NATIVE_BRIDGE_VERSION || nativeShellUserAgent)
    );
  }

  install() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    const receive = (event: MessageEvent) => this.receive(event.data);
    window.addEventListener("message", receive);
    // Android WebView historically dispatches messages on document while
    // standards-based WebViews dispatch on window, so listen to both.
    document.addEventListener("message", receive as EventListenerOrEventListenerObject);
  }

  request<T = unknown>(
    type: NativeBridgeCommand,
    payload?: Record<string, unknown>,
    timeoutMs = type === "file.shareBase64" ? 120_000 : 20_000,
  ): Promise<T> {
    if (!this.isAvailable()) return Promise.reject(new Error("NATIVE_BRIDGE_UNAVAILABLE"));
    this.install();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const message: NativeBridgeRequest = {
      bridge: NATIVE_BRIDGE_NAME,
      version: NATIVE_BRIDGE_VERSION,
      id,
      type,
      ...(payload ? { payload } : {}),
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`NATIVE_BRIDGE_TIMEOUT:${type}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        (window as WebViewWindow).ReactNativeWebView!.postMessage(
          JSON.stringify(message),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  on(type: string, listener: EventListener) {
    this.install();
    const group = this.listeners.get(type) ?? new Set<EventListener>();
    group.add(listener);
    this.listeners.set(type, group);
    return () => group.delete(listener);
  }

  private receive(raw: unknown) {
    if (typeof raw !== "string" || raw.length > 512 * 1024) return;
    let envelope: NativeBridgeEnvelope;
    try {
      envelope = JSON.parse(raw) as NativeBridgeEnvelope;
    } catch {
      return;
    }
    if (
      envelope?.bridge !== NATIVE_BRIDGE_NAME ||
      envelope.version !== NATIVE_BRIDGE_VERSION
    ) return;
    if (envelope.type === "bridge.response") {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(envelope.id);
      if (envelope.ok) pending.resolve(envelope.payload);
      else {
        pending.reject(
          new Error(
            `${envelope.error?.code ?? "NATIVE_ERROR"}:${envelope.error?.message ?? "Native request failed"}`,
          ),
        );
      }
      return;
    }
    for (const listener of this.listeners.get(envelope.type) ?? []) {
      listener(envelope.payload);
    }
  }
}

export const nativeBridge = new NativeBridgeClient();
