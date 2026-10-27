import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildSnapshot, getRevision, loadDocument } from "../../src/worker/services/documents";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import { db, draft, NOW, resetDocuments, seedClient, sentInvoice } from "../helpers/documents";

const OWNER = "owner@custom-fields.test";
const MEMBER = "member@custom-fields.test";

type Scope = "workspace" | "client" | "document";

async function defineField(scope: Scope, label = `${scope} field`): Promise<string> {
  const res = await apiFetch("/api/custom-fields", {
    as: OWNER,
    method: "POST",
    json: { label, type: "text", scope, section: "header" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function putValues(scope: string, entityId: string, values: { fieldId: string; value: string }[]) {
  return apiFetch(`/api/custom-fields/values/${scope}/${entityId}`, {
    as: MEMBER,
    method: "PUT",
    json: { values },
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

beforeAll(async () => {
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
});

beforeEach(resetDocuments);

describe("custom field values", () => {
  it("rejects a field of the wrong scope with invalid_custom_field", async () => {
    const client = await seedClient();
    const documentField = await defineField("document");
    const workspaceField = await defineField("workspace");

    for (const fieldId of [documentField, workspaceField, "missing-field"]) {
      const res = await putValues("client", client.id, [{ fieldId, value: "x" }]);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("invalid_custom_field");
    }
  });

  it("rejects a client field on a document with invalid_custom_field", async () => {
    const client = await seedClient();
    const clientField = await defineField("client");
    const res = await apiFetch("/api/documents", {
      as: MEMBER,
      method: "POST",
      json: {
        kind: "invoice",
        clientId: client.id,
        lines: [{ description: "Design", quantity: "1", unitPrice: 1000 }],
        customFields: [{ fieldId: clientField, value: "x" }],
      },
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_custom_field");
  });

  it("returns 404 for an unknown client", async () => {
    const clientField = await defineField("client");
    const put = await putValues("client", "no-such-client", [{ fieldId: clientField, value: "x" }]);
    expect(put.status).toBe(404);
    expect(await errorCode(put)).toBe("client_not_found");
    const get = await apiFetch("/api/custom-fields/values/client/no-such-client", { as: MEMBER });
    expect(get.status).toBe(404);
  });

  it("an archived field drops out of drafts and stays in sent revisions", async () => {
    const client = await seedClient();
    const clientField = await defineField("client", "Client code");
    const documentField = await defineField("document", "PO number");
    expect(
      (await putValues("client", client.id, [{ fieldId: clientField, value: "NW-01" }])).status,
    ).toBe(200);

    const sent = await sentInvoice({
      clientId: client.id,
      customFields: [{ fieldId: documentField, value: "PO-7" }],
    });
    const later = await draft({
      clientId: client.id,
      customFields: [{ fieldId: documentField, value: "PO-8" }],
    });

    for (const id of [clientField, documentField]) {
      const res = await apiFetch(`/api/custom-fields/${id}/archive`, { as: OWNER, method: "POST" });
      expect(res.status).toBe(200);
    }

    const preview = await buildSnapshot(db, later, { now: NOW });
    expect(preview.customFields).toEqual([]);

    const doc = await loadDocument(db, sent);
    const { snapshot } = await getRevision(db, doc.currentRevisionId ?? "");
    expect(snapshot.customFields.map((f) => [f.label, f.value]).sort()).toEqual([
      ["Client code", "NW-01"],
      ["PO number", "PO-7"],
    ]);
  });
});
