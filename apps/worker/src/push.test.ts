import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { PushRegistry, sendExpoPush, isExpoPushToken } from "./push.js";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

describe("isExpoPushToken", () => {
  it("accepts real-looking Expo tokens and rejects junk", () => {
    expect(isExpoPushToken(TOKEN_A)).toBe(true);
    expect(isExpoPushToken("not-a-token")).toBe(false);
    expect(isExpoPushToken("")).toBe(false);
    expect(isExpoPushToken(123)).toBe(false);
  });
});

describe("PushRegistry", () => {
  it("stores valid tokens and de-duplicates", () => {
    const r = new PushRegistry();
    expect(r.register(TOKEN_A)).toBe(true);
    expect(r.register(TOKEN_A)).toBe(true); // same token again
    expect(r.register(TOKEN_B)).toBe(true);
    expect(r.size).toBe(2);
    expect(r.tokens()).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("rejects invalid tokens", () => {
    const r = new PushRegistry();
    expect(r.register("garbage")).toBe(false);
    expect(r.size).toBe(0);
  });

  it("unregisters", () => {
    const r = new PushRegistry();
    r.register(TOKEN_A);
    r.unregister(TOKEN_A);
    expect(r.size).toBe(0);
  });
});

describe("sendExpoPush", () => {
  it("no-ops with no valid tokens (no request made)", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const out = await sendExpoPush(["garbage"], { title: "t", body: "b" }, { fetchImpl: spy });
    expect(out.sent).toBe(0);
    expect(called).toBe(false);
  });

  it("POSTs one Expo message per token", async () => {
    let payload: any = null;
    const server = await listen((body) => (payload = body), { data: [{ status: "ok" }, { status: "ok" }] });
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as any).port}/send`;
      const out = await sendExpoPush([TOKEN_A, TOKEN_B], { title: "Approval", body: "npm publish", data: { id: "a1" } }, { endpoint });
      expect(out.sent).toBe(2);
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(2);
      expect(payload[0].to).toBe(TOKEN_A);
      expect(payload[0].title).toBe("Approval");
      expect(payload[0].body).toBe("npm publish");
      expect(payload[0].data).toEqual({ id: "a1" });
    } finally {
      server.close();
    }
  });

  it("reports DeviceNotRegistered tokens as invalid for pruning", async () => {
    const server = await listen(() => {}, {
      data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }],
    });
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as any).port}/send`;
      const out = await sendExpoPush([TOKEN_A, TOKEN_B], { title: "t", body: "b" }, { endpoint });
      expect(out.sent).toBe(1);
      expect(out.invalidTokens).toEqual([TOKEN_B]);
    } finally {
      server.close();
    }
  });

  it("never throws when the push service is unreachable", async () => {
    const out = await sendExpoPush([TOKEN_A], { title: "t", body: "b" }, { endpoint: "http://127.0.0.1:1/nope" });
    expect(out.sent).toBe(0);
    expect(out.invalidTokens).toEqual([]);
  });
});

function listen(onBody: (body: unknown) => void, reply: unknown): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          onBody(JSON.parse(data));
        } catch {
          onBody(null);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
