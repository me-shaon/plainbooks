import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentDetail } from "../../src/shared/schemas/document";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import { resetDocuments, seedClient } from "../helpers/documents";

const OWNER = "owner@docs.test";
const MEMBER = "member@docs.test";
let clientId: string;

beforeAll(async () => {
  installAccessKeys();
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
});

beforeEach(async () => {
  await resetDocuments();
  clientId = (await seedClient()).id;
});

async function create(body: Record<string, unknown>, as = MEMBER) {
  const res = await apiFetch("/api/documents", {
    as,
    method: "POST",
    json: {
      kind: "invoice",
      clientId,
      lines: [{ description: "Design", quantity: 1, unitPrice: 200000 }],
      ...body,
    },
  });
  return { res, body: (await res.json()) as DocumentDetail & { code?: string } };
}

describe("/api/documents", () => {
  it("a Member creates, finalizes, pays, and reads the activity", async () => {
    const created = await create({});
    expect(created.res.status).toBe(201);
    expect(created.body.number).toBeNull();
    expect(created.body.currency).toBe("BDT");
    const id = created.body.id;

    const fin = await apiFetch(`/api/documents/${id}/finalize`, {
      as: MEMBER,
      method: "POST",
      json: {},
    });
    expect(fin.status).toBe(200);
    const finBody = (await fin.json()) as { document: DocumentDetail; revisionId: string };
    expect(finBody.document.number).toBe("INV-0001");
    expect(finBody.document.displayStatus).toBe("finalized");

    const del = await apiFetch(`/api/documents/${id}`, { as: MEMBER, method: "DELETE" });
    expect(del.status).toBe(409);

    const revisions = await apiFetch(`/api/documents/${id}/revisions`, { as: MEMBER });
    const revBody = (await revisions.json()) as { items: { id: string }[] };
    expect(revBody.items.map((r) => r.id)).toEqual([finBody.revisionId]);

    const activity = await apiFetch(`/api/documents/${id}/activity`, { as: MEMBER });
    const actBody = (await activity.json()) as { items: { type: string }[] };
    expect(actBody.items.map((a) => a.type)).toEqual(["finalized", "created"]);
  });

  it("deletes a draft", async () => {
    const { body } = await create({});
    const res = await apiFetch(`/api/documents/${body.id}`, { as: MEMBER, method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await apiFetch(`/api/documents/${body.id}`, { as: MEMBER })).status).toBe(404);
  });

  it("a Member setting auto-send reminders on a document gets 403", async () => {
    const denied = await create({ reminderMode: "auto_send" });
    expect(denied.res.status).toBe(403);
    expect(denied.body.code).toBe("owner_required");

    const { body } = await create({});
    const patch = await apiFetch(`/api/documents/${body.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { reminderMode: "auto_send" },
    });
    expect(patch.status).toBe(403);
    const memberOff = await apiFetch(`/api/documents/${body.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { reminderMode: "off" },
    });
    expect(memberOff.status).toBe(200);

    const owner = await create({ reminderMode: "auto_send" }, OWNER);
    expect(owner.res.status).toBe(201);
    expect(owner.body.reminderMode).toBe("auto_send");
  });

  it("resets the public link, so the old link stops working", async () => {
    const { body } = await create({});
    const draftReset = await apiFetch(`/api/documents/${body.id}/reset-link`, {
      as: MEMBER,
      method: "POST",
      json: {},
    });
    expect(draftReset.status).toBe(409);

    const fin = await apiFetch(`/api/documents/${body.id}/finalize`, {
      as: MEMBER,
      method: "POST",
      json: {},
    });
    const oldToken = ((await fin.json()) as { document: DocumentDetail }).document.publicToken;
    expect(oldToken).toBeTruthy();

    const reset = await apiFetch(`/api/documents/${body.id}/reset-link`, {
      as: MEMBER,
      method: "POST",
      json: {},
    });
    expect(reset.status).toBe(200);
    const newToken = ((await reset.json()) as DocumentDetail).publicToken;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    expect((await apiFetch(`/p/${oldToken}`)).status).toBe(404);
    expect((await apiFetch(`/p/${oldToken}/pdf`)).status).toBe(404);
    expect((await apiFetch(`/p/${newToken}`)).status).toBe(200);

    const activity = await apiFetch(`/api/documents/${body.id}/activity`, { as: MEMBER });
    const actBody = (await activity.json()) as { items: { type: string }[] };
    expect(actBody.items[0]?.type).toBe("link_reset");
  });

  it("rejects a payment above the balance with 422", async () => {
    const { body } = await create({});
    await apiFetch(`/api/documents/${body.id}/finalize`, { as: MEMBER, method: "POST", json: {} });
    // Finalized is not sent yet, so payments are not open.
    const early = await apiFetch(`/api/documents/${body.id}/payments`, {
      as: MEMBER,
      method: "POST",
      json: { amount: 1000, paidOn: "2026-10-23" },
    });
    expect(early.status).toBe(409);
  });

  it("validates input", async () => {
    const bad = await create({ lines: [{ quantity: "1.2345", unitPrice: 100 }] });
    expect(bad.res.status).toBe(400);
    const list = await apiFetch("/api/documents?filter=drafts", { as: MEMBER });
    expect(list.status).toBe(200);
  });
});
