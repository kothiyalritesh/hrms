export const NATIVE_BRIDGE_VERSION = 1 as const;
export const NATIVE_BRIDGE_NAME = "bop.hrms.native" as const;

export type NativeBridgeCommand =
  | "bridge.ping"
  | "device.getCapabilities"
  | "auth.syncSession"
  | "auth.clearSession"
  | "notifications.getPermission"
  | "notifications.register"
  | "tracking.getStatus"
  | "tracking.requestPermissions"
  | "tracking.restore"
  | "tracking.start"
  | "tracking.stop"
  | "app.openSettings"
  | "app.checkForUpdate"
  | "file.shareBase64";

export interface NativeBridgeRequest {
  bridge: typeof NATIVE_BRIDGE_NAME;
  version: typeof NATIVE_BRIDGE_VERSION;
  id: string;
  type: NativeBridgeCommand;
  payload?: Record<string, unknown>;
}

export interface NativeBridgeResponse<T = unknown> {
  bridge: typeof NATIVE_BRIDGE_NAME;
  version: typeof NATIVE_BRIDGE_VERSION;
  id: string;
  type: "bridge.response";
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}

export interface NativeBridgeEvent<T = unknown> {
  bridge: typeof NATIVE_BRIDGE_NAME;
  version: typeof NATIVE_BRIDGE_VERSION;
  type: "bridge.ready" | "notification.received" | "notification.opened";
  payload?: T;
}

export type NativeBridgeEnvelope<T = unknown> =
  | NativeBridgeResponse<T>
  | NativeBridgeEvent<T>;

const COMMANDS = new Set<NativeBridgeCommand>([
  "bridge.ping",
  "device.getCapabilities",
  "auth.syncSession",
  "auth.clearSession",
  "notifications.getPermission",
  "notifications.register",
  "tracking.getStatus",
  "tracking.requestPermissions",
  "tracking.restore",
  "tracking.start",
  "tracking.stop",
  "app.openSettings",
  "app.checkForUpdate",
  "file.shareBase64",
]);

export function parseNativeBridgeRequest(raw: string): NativeBridgeRequest {
  // Normal control messages are tiny. Excel data is the only intentionally
  // larger command and is capped separately after its type is known.
  if (!raw || raw.length > 40 * 1024 * 1024) throw new Error("MESSAGE_TOO_LARGE");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_ENVELOPE");
  }
  const request = value as Partial<NativeBridgeRequest>;
  if (
    request.bridge !== NATIVE_BRIDGE_NAME ||
    request.version !== NATIVE_BRIDGE_VERSION ||
    typeof request.id !== "string" ||
    request.id.length < 1 ||
    request.id.length > 100 ||
    typeof request.type !== "string" ||
    !COMMANDS.has(request.type as NativeBridgeCommand) ||
    (request.payload != null &&
      (typeof request.payload !== "object" || Array.isArray(request.payload)))
  ) {
    throw new Error("INVALID_ENVELOPE");
  }
  if (request.type !== "file.shareBase64" && raw.length > 64 * 1024) {
    throw new Error("MESSAGE_TOO_LARGE");
  }
  return request as NativeBridgeRequest;
}

export function bridgeResponse<T>(
  id: string,
  ok: boolean,
  payload?: T,
  error?: { code: string; message: string },
): NativeBridgeResponse<T> {
  return {
    bridge: NATIVE_BRIDGE_NAME,
    version: NATIVE_BRIDGE_VERSION,
    id,
    type: "bridge.response",
    ok,
    ...(payload === undefined ? {} : { payload }),
    ...(error ? { error } : {}),
  };
}

export function bridgeEvent<T>(
  type: NativeBridgeEvent<T>["type"],
  payload?: T,
): NativeBridgeEvent<T> {
  return {
    bridge: NATIVE_BRIDGE_NAME,
    version: NATIVE_BRIDGE_VERSION,
    type,
    ...(payload === undefined ? {} : { payload }),
  };
}
