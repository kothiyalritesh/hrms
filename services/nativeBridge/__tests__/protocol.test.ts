import {
  bridgeResponse,
  NATIVE_BRIDGE_NAME,
  NATIVE_BRIDGE_VERSION,
  parseNativeBridgeRequest,
} from "@/services/nativeBridge/protocol";

describe("versioned native bridge protocol", () => {
  const request = {
    bridge: NATIVE_BRIDGE_NAME,
    version: NATIVE_BRIDGE_VERSION,
    id: "request-1",
    type: "bridge.ping",
    payload: {},
  };

  it("accepts a valid v1 command", () => {
    expect(parseNativeBridgeRequest(JSON.stringify(request))).toEqual(request);
  });

  it.each([
    [{ ...request, version: 2 }],
    [{ ...request, bridge: "other.app" }],
    [{ ...request, type: "native.runArbitraryCode" }],
    [{ ...request, id: "" }],
  ])("rejects an incompatible or unknown envelope", (value) => {
    expect(() => parseNativeBridgeRequest(JSON.stringify(value))).toThrow(
      "INVALID_ENVELOPE",
    );
  });

  it("creates correlated success and error responses", () => {
    expect(bridgeResponse("abc", true, { pong: true })).toMatchObject({
      id: "abc",
      ok: true,
      payload: { pong: true },
      version: 1,
    });
    expect(
      bridgeResponse("abc", false, undefined, {
        code: "FAILED",
        message: "No",
      }),
    ).toMatchObject({ id: "abc", ok: false, error: { code: "FAILED" } });
  });
});
