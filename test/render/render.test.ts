import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_STYLE,
  TEMPLATE_LAYOUTS,
  TEMPLATE_SECTIONS,
  type TemplateConfig,
  type TemplateSection,
} from "../../src/shared/domain";
import type { DocumentSnapshot } from "../../src/shared/schemas/document";
import {
  type BrandKit,
  FONT_CHOICES,
  FONT_WEIGHTS,
  fontFileName,
} from "../../src/shared/schemas/settings";
import {
  normalizeTemplateConfig,
  TEMPLATE_PRESET_CATEGORIES,
  TEMPLATE_PRESETS,
  type TemplateDetail,
  templateConfigInput,
} from "../../src/shared/schemas/template";
import { type RenderState, renderDocument, renderDocumentHtml } from "../../src/worker/render";
import { fontFaceCss, fontFileBytes } from "../../src/worker/render/fonts";
import { sampleSnapshot } from "../../src/worker/render/sample";
import { voidDocument } from "../../src/worker/services/documents";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import { db, NOW, resetDocuments, seedClient, sentInvoice, TODAY } from "../helpers/documents";

const OWNER = "owner@render.test";
const MEMBER = "member@render.test";

const BRAND: BrandKit = {
  businessName: "Studio One",
  logoKey: "logos/aaaa.png",
  logoUrl: "/p/assets/logo/aaaa.png",
  accentColor: "#2f7f6f",
  font: "instrument-sans",
  address: "House 12, Road 5\nDhaka",
  taxId: "BIN 1234",
  bankDetails: "City Bank\nAccount 0042",
  footerText: "Thank you",
};

function state(overrides: Partial<RenderState> = {}): RenderState {
  return {
    status: "sent",
    amountPaid: 0,
    today: TODAY,
    timeZone: "Asia/Dhaka",
    decidedAt: null,
    decisionComment: null,
    ...overrides,
  };
}

function config(
  layout: TemplateConfig["layout"],
  order: readonly TemplateSection[] = TEMPLATE_SECTIONS,
  hidden: TemplateSection[] = [],
  customFields: TemplateConfig["customFields"] = [],
  style: Partial<TemplateConfig["style"]> = {},
): TemplateConfig {
  return {
    layout,
    sections: order.map((id) => ({ id, visible: !hidden.includes(id) })),
    customFields,
    style: { ...DEFAULT_TEMPLATE_STYLE, ...style },
  };
}

function sample(cfg: TemplateConfig, brand: Partial<BrandKit> = {}): DocumentSnapshot {
  return sampleSnapshot({
    brandKit: { ...BRAND, ...brand },
    config: cfg,
    defs: [],
    homeCurrency: "BDT",
    today: TODAY,
    now: NOW,
  });
}

function sectionIndexes(html: string): TemplateSection[] {
  const found = [...html.matchAll(/class="sec sec-([a-z_]+)/g)].map((m) => m[1] as TemplateSection);
  return found;
}

function sectionHtml(html: string, id: TemplateSection): string {
  const start = html.indexOf(`sec sec-${id}`);
  if (start === -1) return "";
  const next = html.indexOf('class="sec sec-', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
}

beforeAll(async () => {
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
});

beforeEach(async () => {
  await resetDocuments();
  await env.DB.prepare(
    "UPDATE workspace SET bank_details = 'City Bank 0042', accent_color = '#2f7f6f'",
  ).run();
});

describe("renderDocumentHtml", () => {
  const shuffled: TemplateSection[] = [
    "bill_to",
    "header",
    "totals",
    "line_items",
    "footer",
    "payment_details",
    "notes",
  ];

  for (const layout of TEMPLATE_LAYOUTS) {
    it(`${layout} renders every section in config order`, () => {
      const html = renderDocumentHtml(sample(config(layout, shuffled)), {
        mode: "page",
        state: state(),
      });
      expect(html).toContain(`layout-${layout}`);
      expect(sectionIndexes(html)).toEqual(shuffled);
    });
  }

  it("leaves a hidden section out of the HTML", () => {
    const html = renderDocumentHtml(
      sample(config("classic", TEMPLATE_SECTIONS, ["payment_details", "notes"])),
      { mode: "page", state: state() },
    );
    expect(html).not.toContain("sec-payment_details");
    expect(html).not.toContain("Pay by bank transfer");
    expect(html).not.toContain("sec-notes");
    expect(sectionIndexes(html)).toHaveLength(5);
  });

  it("prints a custom field in its template section, and an empty value prints nothing", () => {
    const snapshot = sample(
      config("classic", TEMPLATE_SECTIONS, [], [{ fieldId: "po", section: "bill_to" }]),
    );
    snapshot.customFields = [
      { fieldId: "po", label: "PO number", type: "text", section: "footer", value: "PO-77" },
      { fieldId: "empty", label: "Empty field", type: "text", section: "bill_to", value: "" },
    ];
    const html = renderDocumentHtml(snapshot, { mode: "page", state: state() });
    expect(sectionHtml(html, "bill_to")).toContain("PO-77");
    expect(sectionHtml(html, "footer")).not.toContain("PO-77");
    expect(html).not.toContain("Empty field");
  });

  it("formats a date custom field", () => {
    const snapshot = sample(config("minimal"));
    snapshot.customFields = [
      { fieldId: "d", label: "Delivery", type: "date", section: "header", value: "2026-11-02" },
    ];
    const html = renderDocumentHtml(snapshot, { mode: "page", state: state() });
    expect(sectionHtml(html, "header")).toContain("2 Nov 2026");
  });

  it("escapes every snapshot value", () => {
    const snapshot = sample(config("bold"), {
      businessName: '<img src=x onerror="alert(1)">',
      bankDetails: "</style><script>alert(2)</script>",
    });
    snapshot.client.name = "<script>alert(3)</script>";
    const [first, ...rest] = snapshot.lines;
    if (!first) throw new Error("sample has no lines");
    snapshot.lines = [{ ...first, description: '"><svg onload=alert(4)>' }, ...rest];
    const html = renderDocumentHtml(snapshot, { mode: "page", state: state() });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
  });

  it("falls back to the default accent for a color that is not hex", () => {
    const html = renderDocumentHtml(
      sample(config("bold"), { accentColor: "red;}</style><script>" }),
      { mode: "page", state: state() },
    );
    expect(html).toContain("--accent:#1f5a4e");
    expect(html).not.toContain("<script");
  });

  it("shows the status banners", () => {
    const snapshot = sample(config("classic"));
    const total = snapshot.totals.total;
    const render = (s: Partial<RenderState>) =>
      renderDocumentHtml(snapshot, { mode: "page", state: state(s) });

    const voided = render({ status: "void" });
    expect(voided).toContain("<strong>Void</strong>");
    expect(voided).not.toContain("Pay by bank transfer");

    const paid = render({ status: "paid", amountPaid: total });
    expect(paid).toContain("<strong>Paid</strong>");
    expect(paid).not.toContain("Pay by bank transfer");

    const partial = render({ status: "partially_paid", amountPaid: 10000 });
    expect(partial).toContain("Partially paid");
    expect(partial).toContain("Balance due");
    expect(partial).toContain("Pay by bank transfer");

    const overdue = render({ today: "2027-01-01" });
    expect(overdue).toContain("<strong>Overdue</strong>");
    expect(overdue).toContain(`This invoice was due on`);

    const revised = renderDocumentHtml(
      { ...snapshot, document: { ...snapshot.document, revisionNumber: 2 } },
      { mode: "page", state: state() },
    );
    expect(revised).toContain("Revised on 23 Oct 2026");
  });

  it("page mode loads fonts, CSS, and the logo from /p/assets only", () => {
    const html = renderDocumentHtml(sample(config("classic")), {
      mode: "page",
      state: state(),
      pdfUrl: "/p/token/pdf",
    });
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"|url\(([^)]+)\)/g)].map(
      (m) => m[1] ?? m[2] ?? "",
    );
    expect(urls.length).toBeGreaterThan(3);
    for (const url of urls) expect(url.startsWith("/p/")).toBe(true);
    expect(html).toContain('href="/p/assets/document.css"');
    expect(html).toContain("/p/assets/fonts/instrument-sans-400.woff2");
    expect(html).toContain('src="/p/assets/logo/aaaa.png"');
  });

  it("pdf mode inlines the fonts, the CSS, and the logo", async () => {
    await env.BUCKET.put("logos/aaaa.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const html = await renderDocument(env, sample(config("classic"), { font: "source-serif-4" }), {
      mode: "pdf",
      state: state(),
    });
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain('"Source Serif 4"');
    expect(html).toContain('src="data:image/png;base64,iVBORw=="');
    expect(html).not.toContain("/p/assets");
    expect(html).toContain("@page{size:A4");
  });
});

describe("template style", () => {
  it("adds a class for each style option", () => {
    const html = renderDocumentHtml(
      sample(
        config("boxed", TEMPLATE_SECTIONS, [], [], {
          striped: true,
          compact: true,
          centeredHeader: true,
        }),
      ),
      { mode: "page", state: state() },
    );
    expect(html).toContain('class="page layout-boxed opt-striped opt-compact opt-center"');
  });

  it("uses the template color and font over the brand kit", () => {
    const own = renderDocumentHtml(
      sample(config("modern", TEMPLATE_SECTIONS, [], [], { accentColor: "#b91c1c", font: "lora" })),
      { mode: "page", state: state() },
    );
    expect(own).toContain("--accent:#b91c1c");
    expect(own).toContain('--font:"Lora", serif');
    expect(own).toContain("/p/assets/fonts/lora-400.woff2");

    const brand = renderDocumentHtml(sample(config("modern")), { mode: "page", state: state() });
    expect(brand).toContain(`--accent:${BRAND.accentColor}`);
    expect(brand).toContain("/p/assets/fonts/instrument-sans-400.woff2");
  });

  it("reads an older config with no style as the default style", () => {
    const { style, ...old } = config("classic");
    expect(normalizeTemplateConfig(old).style).toEqual(DEFAULT_TEMPLATE_STYLE);
    expect(style).toEqual(DEFAULT_TEMPLATE_STYLE);
  });

  it("gives every ready-made template a valid config that an invoice can use", () => {
    for (const preset of TEMPLATE_PRESETS) {
      expect(templateConfigInput.safeParse(preset.config).success, preset.id).toBe(true);
      // Header, bill to, line items, totals, and payment details stay visible.
      for (const id of ["header", "bill_to", "line_items", "totals", "payment_details"]) {
        const section = preset.config.sections.find((s) => s.id === id);
        expect(section?.visible, `${preset.id} ${id}`).toBe(true);
      }
    }
  });

  it("offers at least three minimal, professional, and modern designs", () => {
    for (const category of TEMPLATE_PRESET_CATEGORIES) {
      const count = TEMPLATE_PRESETS.filter((p) => p.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(TEMPLATE_PRESETS.map((p) => p.id)).size).toBe(TEMPLATE_PRESETS.length);
  });

  it("prints the taxable amount per rate when the rates differ", () => {
    const html = renderDocumentHtml(sample(config("classic")), { mode: "page", state: state() });
    // The sample has VAT 15% and Service tax 5%.
    expect(html).toMatch(/VAT 15%<span class="tax-base"> on USD [\d,]+\.\d\d<\/span>/);
    expect(html).toMatch(/Service tax 5%<span class="tax-base"> on USD [\d,]+\.\d\d<\/span>/);
  });
});

describe("document fonts", () => {
  it("bundles 400, 500, and 600 for every brand kit font", () => {
    for (const choice of FONT_CHOICES) {
      for (const weight of FONT_WEIGHTS) {
        const bytes = fontFileBytes(fontFileName(choice.id, weight));
        expect(bytes?.byteLength, `${choice.id} ${weight}`).toBeGreaterThan(1000);
        // A woff2 file starts with "wOF2".
        expect(String.fromCharCode(...(bytes ?? []).slice(0, 4))).toBe("wOF2");
      }
      const css = fontFaceCss(choice.id, "page");
      expect(css).toContain(`/p/assets/fonts/${fontFileName(choice.id, 600)}`);
      expect(css).toContain(choice.stack.split(",")[0]);
    }
  });
});

describe("/render routes", () => {
  it("rejects a request without a session", async () => {
    for (const path of ["/render/x", "/render/draft/x"]) {
      expect((await apiFetch(path)).status).toBe(401);
    }
    const res = await apiFetch("/render/preview", { method: "POST", json: {} });
    expect(res.status).toBe(401);
  });

  it("renders the sample invoice for a template preview", async () => {
    const res = await apiFetch("/render/preview", {
      as: MEMBER,
      method: "POST",
      json: { config: { layout: "bold", sections: [{ id: "bill_to", visible: true }] } },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Halden &amp; Co");
    expect(html).toContain("layout-bold");
    // Sections that the config leaves out are hidden.
    expect(sectionIndexes(html)).toEqual(["bill_to"]);
    expect(html).toContain("PO-5521");
  });

  it("escapes a client name with a script tag", async () => {
    const client = await seedClient({ name: "<script>alert(1)</script>" });
    const id = await sentInvoice({ clientId: client.id });
    const revisionId = await currentRevision(id);
    const res = await apiFetch(`/render/${revisionId}`, { as: MEMBER });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("AE5: a sent revision keeps the old logo, and a draft uses the new one", async () => {
    await env.DB.prepare("UPDATE workspace SET logo_key = 'logos/old.png'").run();
    const client = await seedClient();
    const sentId = await sentInvoice({ clientId: client.id });
    const revisionId = await currentRevision(sentId);
    await env.DB.prepare("UPDATE workspace SET logo_key = 'logos/new.png'").run();
    const draftRes = await apiFetch("/api/documents", {
      as: MEMBER,
      method: "POST",
      json: { kind: "invoice", clientId: client.id, lines: [{ unitPrice: 100 }] },
    });
    const draftId = ((await draftRes.json()) as { id: string }).id;

    const revisionHtml = await (await apiFetch(`/render/${revisionId}`, { as: MEMBER })).text();
    expect(revisionHtml).toContain("/p/assets/logo/old.png");
    expect(revisionHtml).not.toContain("new.png");

    const draftHtml = await (await apiFetch(`/render/draft/${draftId}`, { as: MEMBER })).text();
    expect(draftHtml).toContain("/p/assets/logo/new.png");
    expect(draftHtml).toContain(">Draft<");
  });

  it("shows the Void banner on a void invoice", async () => {
    const client = await seedClient();
    const id = await sentInvoice({ clientId: client.id });
    await voidDocument(db, id, { now: NOW });
    const html = await (
      await apiFetch(`/render/${await currentRevision(id)}`, { as: MEMBER })
    ).text();
    expect(html).toContain("<strong>Void</strong>");
  });

  it("returns 404 for an unknown revision", async () => {
    expect((await apiFetch("/render/nope", { as: MEMBER })).status).toBe(404);
  });
});

describe("/api/templates", () => {
  it("an Owner creates, edits, sets the default, and cannot delete a template in use", async () => {
    const created = await apiFetch("/api/templates", {
      as: OWNER,
      method: "POST",
      json: { name: "Agency", layout: "minimal" },
    });
    expect(created.status).toBe(201);
    const template = (await created.json()) as TemplateDetail;
    expect(template.config.sections).toHaveLength(7);
    expect(template.config.layout).toBe("minimal");

    const updated = await apiFetch(`/api/templates/${template.id}`, {
      as: OWNER,
      method: "PATCH",
      json: {
        name: "Agency bold",
        config: { layout: "bold", sections: [{ id: "totals", visible: true }] },
      },
    });
    const detail = (await updated.json()) as TemplateDetail;
    expect(detail.name).toBe("Agency bold");
    expect(detail.layout).toBe("bold");
    expect(detail.config.sections[0]).toEqual({ id: "totals", visible: true });
    expect(detail.config.sections.filter((s) => s.visible)).toHaveLength(1);

    const bad = await apiFetch(`/api/templates/${template.id}`, {
      as: OWNER,
      method: "PATCH",
      json: {
        config: {
          layout: "bold",
          sections: [
            { id: "totals", visible: true },
            { id: "totals", visible: false },
          ],
        },
      },
    });
    expect(bad.status).toBe(400);

    const def = await apiFetch(`/api/templates/${template.id}/default`, {
      as: OWNER,
      method: "POST",
    });
    expect(((await def.json()) as TemplateDetail).isDefault).toBe(true);

    const del = await apiFetch(`/api/templates/${template.id}`, { as: OWNER, method: "DELETE" });
    expect(del.status).toBe(409);

    // A draft now renders with the workspace default template.
    const client = await seedClient();
    const draftRes = await apiFetch("/api/documents", {
      as: MEMBER,
      method: "POST",
      json: { kind: "invoice", clientId: client.id, lines: [{ unitPrice: 100 }] },
    });
    const draftId = ((await draftRes.json()) as { id: string }).id;
    const html = await (await apiFetch(`/render/draft/${draftId}`, { as: MEMBER })).text();
    expect(html).toContain("layout-bold");
    expect(sectionIndexes(html)).toEqual(["totals"]);
  });

  it("creates a template from a ready-made config", async () => {
    const proposal = TEMPLATE_PRESETS.find((p) => p.id === "proposal");
    const res = await apiFetch("/api/templates", {
      as: OWNER,
      method: "POST",
      json: { name: "Proposal", layout: "classic", config: proposal?.config },
    });
    expect(res.status).toBe(201);
    const template = (await res.json()) as TemplateDetail;
    // The config's layout wins over the layout field.
    expect(template.layout).toBe("modern");
    expect(template.config).toEqual(proposal?.config);

    const bad = await apiFetch("/api/templates", {
      as: OWNER,
      method: "POST",
      json: {
        name: "Bad",
        layout: "classic",
        config: { ...proposal?.config, style: { accentColor: "red" } },
      },
    });
    expect(bad.status).toBe(400);
  });

  it("deletes an unused template", async () => {
    const created = await apiFetch("/api/templates", {
      as: OWNER,
      method: "POST",
      json: { name: "Spare", layout: "classic" },
    });
    const { id } = (await created.json()) as TemplateDetail;
    expect((await apiFetch(`/api/templates/${id}`, { as: OWNER, method: "DELETE" })).status).toBe(
      204,
    );
    expect((await apiFetch(`/api/templates/${id}`, { as: OWNER })).status).toBe(404);
  });

  it("Members can read but not change templates", async () => {
    const res = await apiFetch("/api/templates", {
      as: MEMBER,
      method: "POST",
      json: { name: "Nope", layout: "classic" },
    });
    expect(res.status).toBe(403);
    expect((await apiFetch("/api/templates", { as: MEMBER })).status).toBe(200);
  });
});

describe("/api/custom-fields", () => {
  it("an Owner defines fields, and values print in the snapshot", async () => {
    const res = await apiFetch("/api/custom-fields", {
      as: OWNER,
      method: "POST",
      json: { label: "Client code", type: "text", scope: "client", section: "bill_to" },
    });
    expect(res.status).toBe(201);
    const field = (await res.json()) as { id: string };
    const client = await seedClient();
    const put = await apiFetch(`/api/custom-fields/values/client/${client.id}`, {
      as: MEMBER,
      method: "PUT",
      json: { values: [{ fieldId: field.id, value: "NW-01" }] },
    });
    expect(put.status).toBe(200);

    const id = await sentInvoice({ clientId: client.id });
    const html = await (
      await apiFetch(`/render/${await currentRevision(id)}`, { as: MEMBER })
    ).text();
    expect(sectionHtml(html, "bill_to")).toContain("NW-01");

    const member = await apiFetch("/api/custom-fields", {
      as: MEMBER,
      method: "POST",
      json: { label: "X", type: "text", scope: "client", section: "bill_to" },
    });
    expect(member.status).toBe(403);
    const workspaceValue = await apiFetch("/api/custom-fields/values/workspace/workspace", {
      as: MEMBER,
      method: "PUT",
      json: { values: [] },
    });
    expect(workspaceValue.status).toBe(403);
  });
});

async function currentRevision(documentId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT current_revision_id AS id FROM documents WHERE id = ?")
    .bind(documentId)
    .first<{ id: string }>();
  if (!row?.id) throw new Error("no revision");
  return row.id;
}
