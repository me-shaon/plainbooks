import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { BrandKit, TeamMember, WorkspaceSettings } from "../../src/shared/schemas/settings";
import type { TaxRate } from "../../src/shared/schemas/tax-rate";
import { createDb, schema } from "../../src/worker/db/client";
import { getBrandKit } from "../../src/worker/services/settings";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";

const db = createDb(env.DB);
const OWNER = "owner@settings.test";
const MEMBER = "member@settings.test";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SAFE_SVG = `<?xml version="1.0"?>
<!-- Logo -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#2f7f6f"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)"/><use xlink:href="#g"/>
</svg>`;

function uploadLogo(body: BodyInit, contentType: string, as = OWNER) {
  return apiFetch("/api/settings/brand-kit/logo", {
    as,
    method: "POST",
    body,
    headers: { "content-type": contentType },
  });
}

async function resetWorkspace() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM client_contacts"),
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM clients"),
    env.DB.prepare("DELETE FROM tax_rates"),
    env.DB.prepare(
      `UPDATE workspace SET home_currency = 'BDT', timezone = 'Asia/Dhaka', logo_key = NULL,
       bank_details = NULL, accent_color = '#1f5a4e', default_tax_rate_id = NULL,
       reminder_schedule = '[{"offsetDays":-3},{"offsetDays":0},{"offsetDays":7},{"offsetDays":14},{"offsetDays":21}]'
       WHERE id = 1`,
    ),
  ]);
}

beforeEach(async () => {
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
  await resetWorkspace();
});

describe("workspace settings", () => {
  it("lets a Member read the settings", async () => {
    const res = await apiFetch("/api/settings/workspace", { as: MEMBER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceSettings;
    expect(body.homeCurrency).toBe("BDT");
    expect(body.timezone).toBe("Asia/Dhaka");
    expect(body.homeCurrencyLocked).toBe(false);
  });

  it("returns 403 when a Member changes the settings", async () => {
    const res = await apiFetch("/api/settings/workspace", {
      as: MEMBER,
      method: "PATCH",
      json: { invoicePrefix: "X-" },
    });
    expect(res.status).toBe(403);
  });

  it("saves prefixes, terms, and a sorted reminder schedule", async () => {
    const res = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: {
        invoicePrefix: "AG-",
        numberPadding: 5,
        defaultPaymentTermsDays: 30,
        reminderSchedule: [{ offsetDays: 10 }, { offsetDays: -2 }, { offsetDays: 0 }],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceSettings;
    expect(body.invoicePrefix).toBe("AG-");
    expect(body.numberPadding).toBe(5);
    expect(body.defaultPaymentTermsDays).toBe(30);
    expect(body.reminderSchedule.map((s) => s.offsetDays)).toEqual([-2, 0, 10]);
  });

  it("rejects an unknown time zone and duplicate reminder steps", async () => {
    const res = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: { timezone: "Mars/Olympus", reminderSchedule: [{ offsetDays: 1 }, { offsetDays: 1 }] },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path).sort()).toEqual(["reminderSchedule", "timezone"]);
  });

  it("changes the home currency while no invoice was sent", async () => {
    await db.insert(schema.clients).values({ id: "c1", name: "Draft only" });
    await db
      .insert(schema.documents)
      .values({ kind: "invoice", clientId: "c1", currency: "USD", status: "draft" });
    const res = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: { homeCurrency: "USD" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as WorkspaceSettings).homeCurrency).toBe("USD");
  });

  it("blocks a home currency change after a document was finalized but not sent", async () => {
    await db.insert(schema.clients).values({ id: "c1", name: "Northwind" });
    await db.insert(schema.documents).values({
      kind: "quote",
      clientId: "c1",
      currency: "USD",
      status: "draft",
      number: "QUO-0001",
      currentRevisionId: "rev-1",
      revisionCount: 1,
    });

    const settings = await apiFetch("/api/settings/workspace", { as: OWNER });
    expect(((await settings.json()) as WorkspaceSettings).homeCurrencyLocked).toBe(true);
    const res = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: { homeCurrency: "USD" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("home_currency_locked");
  });

  it("blocks a home currency change after an invoice was sent", async () => {
    await db.insert(schema.clients).values({ id: "c1", name: "Northwind" });
    await db.insert(schema.documents).values({
      kind: "invoice",
      clientId: "c1",
      currency: "USD",
      status: "sent",
      number: "INV-0001",
      sentAt: Date.now(),
    });

    const settings = await apiFetch("/api/settings/workspace", { as: OWNER });
    expect(((await settings.json()) as WorkspaceSettings).homeCurrencyLocked).toBe(true);

    const res = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: { homeCurrency: "USD" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("home_currency_locked");

    // Sending the same currency again is not a change.
    const same = await apiFetch("/api/settings/workspace", {
      as: OWNER,
      method: "PATCH",
      json: { homeCurrency: "BDT", timezone: "Asia/Dhaka" },
    });
    expect(same.status).toBe(200);
  });
});

describe("brand kit", () => {
  it("saves bank details that drafts then read", async () => {
    const res = await apiFetch("/api/settings/brand-kit", {
      as: OWNER,
      method: "PATCH",
      json: {
        bankDetails: "City Bank\nAccount 123",
        accentColor: "#2F7F6F",
        font: "ibm-plex-sans",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrandKit;
    expect(body.bankDetails).toBe("City Bank\nAccount 123");
    expect(body.accentColor).toBe("#2f7f6f");

    // Drafts render from the live brand kit (getBrandKit), so a new draft shows the change.
    expect((await getBrandKit(db)).bankDetails).toBe("City Bank\nAccount 123");

    const asMember = await apiFetch("/api/settings/brand-kit", { as: MEMBER });
    expect(asMember.status).toBe(200);
    expect(((await asMember.json()) as BrandKit).bankDetails).toBe("City Bank\nAccount 123");
  });

  it("returns 403 when a Member edits the brand kit", async () => {
    const res = await apiFetch("/api/settings/brand-kit", {
      as: MEMBER,
      method: "PATCH",
      json: { bankDetails: "Mine now" },
    });
    expect(res.status).toBe(403);
    expect((await uploadLogo(PNG, "image/png", MEMBER)).status).toBe(403);
  });

  it("rejects an invalid accent color", async () => {
    const res = await apiFetch("/api/settings/brand-kit", {
      as: OWNER,
      method: "PATCH",
      json: { accentColor: "teal" },
    });
    expect(res.status).toBe(400);
  });
});

describe("logo upload", () => {
  it("stores a PNG at a content-addressed key and serves it publicly", async () => {
    const res = await uploadLogo(PNG, "image/png");
    expect(res.status).toBe(200);
    const kit = (await res.json()) as BrandKit;
    expect(kit.logoKey).toMatch(/^logos\/[a-f0-9]{64}\.png$/);
    expect(kit.logoUrl).toBe(`/p/assets/logo/${kit.logoKey?.slice("logos/".length)}`);

    // No session: the route is public.
    const logo = await exports.default.fetch(`https://app.test${kit.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(logo.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(logo.headers.get("x-content-type-options")).toBe("nosniff");
    expect(logo.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG);
  });

  it("keeps the old logo file after a new upload", async () => {
    const first = (await (await uploadLogo(PNG, "image/png")).json()) as BrandKit;
    const second = (await (await uploadLogo(SAFE_SVG, "image/svg+xml")).json()) as BrandKit;
    expect(second.logoKey).not.toBe(first.logoKey);
    expect(second.logoKey).toMatch(/\.svg$/);
    expect(await env.BUCKET.head(first.logoKey ?? "")).not.toBeNull();

    const removed = await apiFetch("/api/settings/brand-kit/logo", { as: OWNER, method: "DELETE" });
    expect(((await removed.json()) as BrandKit).logoKey).toBeNull();
    expect(await env.BUCKET.head(second.logoKey ?? "")).not.toBeNull();
  });

  it.each([
    ["a script element", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["an event handler", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
    ["a slash event handler", '<svg/onload="alert(1)"></svg>'],
    [
      "foreignObject",
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>x</p></foreignObject></svg>',
    ],
    [
      "an external href",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.test/a.png"/></svg>',
    ],
    [
      "a javascript link",
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"/></svg>',
    ],
    [
      "an external CSS url",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://x.test/a)"/></svg>',
    ],
    ["an entity", '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ["a non-SVG root", "<html><body>hi</body></html>"],
  ])("rejects an SVG with %s", async (_name, svg) => {
    const res = await uploadLogo(svg, "image/svg+xml");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_logo");
  });

  it("rejects other file types, mismatched content, and files over 1 MB", async () => {
    expect((await uploadLogo("GIF89a", "image/gif")).status).toBe(400);
    expect((await uploadLogo("not a png", "image/png")).status).toBe(400);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    expect((await uploadLogo(big, "image/png")).status).toBe(413);
  });

  it("rejects a chunked upload over 1 MB that has no Content-Length", async () => {
    const chunk = new Uint8Array(256 * 1024);
    chunk.set(PNG);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await uploadLogo(stream, "image/png");
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("logo_too_large");
  });

  it("returns 404 for unknown or malformed logo paths", async () => {
    const missing = await exports.default.fetch(
      `https://app.test/p/assets/logo/${"a".repeat(64)}.png`,
    );
    expect(missing.status).toBe(404);
    const malformed = await exports.default.fetch(
      "https://app.test/p/assets/logo/..%2Fpdfs%2Fx.pdf",
    );
    expect(malformed.status).toBe(404);
  });
});

describe("tax rates", () => {
  it("creates, edits, archives, and restores a tax rate", async () => {
    const created = await apiFetch("/api/tax-rates", {
      as: OWNER,
      method: "POST",
      json: { name: "VAT", rate: "15.00", note: "" },
    });
    expect(created.status).toBe(201);
    const rate = (await created.json()) as TaxRate;
    expect(rate).toMatchObject({ name: "VAT", rate: "15", note: null, archivedAt: null });

    const edited = await apiFetch(`/api/tax-rates/${rate.id}`, {
      as: OWNER,
      method: "PATCH",
      json: { rate: 7.5, note: "Reverse charge" },
    });
    expect((await edited.json()) as TaxRate).toMatchObject({ rate: "7.5", note: "Reverse charge" });

    await apiFetch(`/api/tax-rates/${rate.id}/archive`, { as: OWNER, method: "POST" });
    const active = (await (await apiFetch("/api/tax-rates", { as: MEMBER })).json()) as {
      items: TaxRate[];
    };
    expect(active.items).toHaveLength(0);
    const all = (await (
      await apiFetch("/api/tax-rates?archived=include", { as: MEMBER })
    ).json()) as { items: TaxRate[] };
    expect(all.items[0]?.archivedAt).toBeTypeOf("number");

    const restored = await apiFetch(`/api/tax-rates/${rate.id}/restore`, {
      as: OWNER,
      method: "POST",
    });
    expect(((await restored.json()) as TaxRate).archivedAt).toBeNull();
  });

  it("rejects a percent above 100 and Member writes", async () => {
    const bad = await apiFetch("/api/tax-rates", {
      as: OWNER,
      method: "POST",
      json: { name: "Too much", rate: "101" },
    });
    expect(bad.status).toBe(400);
    const member = await apiFetch("/api/tax-rates", {
      as: MEMBER,
      method: "POST",
      json: { name: "VAT", rate: "15" },
    });
    expect(member.status).toBe(403);
  });
});

describe("team", () => {
  async function members(): Promise<TeamMember[]> {
    const res = await apiFetch("/api/team", { as: OWNER });
    return ((await res.json()) as { items: TeamMember[] }).items;
  }

  it("is hidden from Members", async () => {
    expect((await apiFetch("/api/team", { as: MEMBER })).status).toBe(403);
    const add = await apiFetch("/api/team", {
      as: MEMBER,
      method: "POST",
      json: { email: "x@settings.test" },
    });
    expect(add.status).toBe(403);
  });

  it("adds a member, changes the role, and removes them", async () => {
    const added = await apiFetch("/api/team", {
      as: OWNER,
      method: "POST",
      json: { email: "New@Settings.test", role: "member" },
    });
    expect(added.status).toBe(201);
    const member = (await added.json()) as TeamMember;
    expect(member.email).toBe("new@settings.test");

    const duplicate = await apiFetch("/api/team", {
      as: OWNER,
      method: "POST",
      json: { email: "new@settings.test" },
    });
    expect(duplicate.status).toBe(409);

    const promoted = await apiFetch(`/api/team/${member.id}`, {
      as: OWNER,
      method: "PATCH",
      json: { role: "owner" },
    });
    expect(((await promoted.json()) as TeamMember).role).toBe("owner");

    const removed = await apiFetch(`/api/team/${member.id}`, { as: OWNER, method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await members()).map((m) => m.email)).toEqual([MEMBER, OWNER]);
  });

  it("keeps the last Owner", async () => {
    const owner = (await members()).find((m) => m.email === OWNER);
    const demote = await apiFetch(`/api/team/${owner?.id}`, {
      as: OWNER,
      method: "PATCH",
      json: { role: "member" },
    });
    expect(demote.status).toBe(409);
    expect(((await demote.json()) as { code: string }).code).toBe("last_owner");

    const self = await apiFetch(`/api/team/${owner?.id}`, { as: OWNER, method: "DELETE" });
    expect(self.status).toBe(409);
  });

  it("stops an Owner from removing themselves while another Owner exists", async () => {
    const team = await members();
    const owner = team.find((m) => m.email === OWNER);
    const other = team.find((m) => m.email === MEMBER);
    const promote = await apiFetch(`/api/team/${other?.id}`, {
      as: OWNER,
      method: "PATCH",
      json: { role: "owner" },
    });
    expect(promote.status).toBe(200);

    const self = await apiFetch(`/api/team/${owner?.id}`, { as: OWNER, method: "DELETE" });
    expect(self.status).toBe(409);
    expect(((await self.json()) as { code: string }).code).toBe("cannot_remove_self");
    expect((await members()).find((m) => m.id === owner?.id)?.role).toBe("owner");
  });
});
