import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MoneyError } from "../src/shared/money";
import { AppError, handleError, parseJson } from "../src/worker/errors";

const JSON_HEADERS = { "content-type": "application/json" };

const app = new Hono();
app.onError(handleError);
app.get("/app-error", () => {
  throw new AppError(409, "conflict", "Already done");
});
app.get("/money", () => {
  throw new MoneyError("Unknown currency: XYZ");
});
app.get("/http", () => {
  throw new HTTPException(429, { message: "Slow down" });
});
app.get("/boom", () => {
  throw new Error("secret detail");
});
app.post("/zod", async (c) => c.json(await parseJson(c, z.object({ name: z.string().min(1) }))));

describe("JSON error handler", () => {
  it("maps known errors to 4xx JSON", async () => {
    expect(await (await app.request("/app-error")).json()).toEqual({
      error: "Already done",
      code: "conflict",
    });
    const money = await app.request("/money");
    expect(money.status).toBe(400);
    expect(await money.json()).toMatchObject({ code: "invalid_amount" });
    const http = await app.request("/http");
    expect(http.status).toBe(429);
    expect(await http.json()).toEqual({ error: "Slow down" });
  });

  it("maps Zod errors and invalid JSON to 400", async () => {
    const bad = await app.request("/zod", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "" }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_request", issues: [{ path: "name" }] });
    const notJson = await app.request("/zod", { method: "POST", headers: JSON_HEADERS, body: "{" });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ code: "invalid_json" });
  });

  it("rejects a JSON body that is not sent as application/json", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
      const res = await app.request("/zod", {
        method: "POST",
        headers: type ? { "content-type": type } : {},
        body: JSON.stringify({ name: "Ada" }),
      });
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ code: "unsupported_media_type" });
    }
    const ok = await app.request("/zod", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: "Ada" }),
    });
    expect(ok.status).toBe(200);
  });

  it("hides unexpected errors behind a 500", async () => {
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
