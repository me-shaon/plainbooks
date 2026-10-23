import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "./helpers/auth";

const worker = exports.default;

beforeAll(async () => {
  installAccessKeys();
  await clearUsers();
  await seedUser("health@example.com", "member");
});

describe("worker routing", () => {
  it("returns health JSON for a signed-in member", async () => {
    const res = await apiFetch("/api/health", { as: "health@example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves the SPA index.html for app navigations", async () => {
    const res = await worker.fetch("https://app.test/invoices", {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root"></div>');
  });

  it("returns 404 for unknown public links", async () => {
    const res = await worker.fetch("https://app.test/p/unknown");
    expect(res.status).toBe(404);
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await apiFetch("/api/nope", { as: "health@example.com" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
