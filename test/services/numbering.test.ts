import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { finalize } from "../../src/worker/services/documents";
import { formatDocumentNumber } from "../../src/worker/services/numbering";
import { db, draft, NOW, noFetch, resetDocuments, seedClient } from "../helpers/documents";

let clientId: string;

beforeEach(async () => {
  await resetDocuments();
  clientId = (await seedClient()).id;
});

describe("numbering", () => {
  it("uses the workspace prefix and padding, and grows past the padding", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE workspace SET invoice_prefix = 'A/', number_padding = 3"),
      env.DB.prepare("UPDATE counters SET value = 999 WHERE name = 'invoice'"),
    ]);
    try {
      const id = await draft({ clientId });
      const result = await finalize(db, id, { now: NOW, fetcher: noFetch });
      expect(result.document.number).toBe("A/1000");
      expect(formatDocumentNumber("A/", 3, 1000)).toBe("A/1000");
      expect(formatDocumentNumber("INV-", 4, 7)).toBe("INV-0007");
    } finally {
      await env.DB.prepare(
        "UPDATE workspace SET invoice_prefix = 'INV-', number_padding = 4",
      ).run();
    }
  });

  it("five concurrent finalize calls get five consecutive numbers", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => draft({ clientId })));
    const results = await Promise.all(
      ids.map((id) => finalize(db, id, { now: NOW, fetcher: noFetch })),
    );
    expect(results.map((r) => r.document.number).sort()).toEqual([
      "INV-0001",
      "INV-0002",
      "INV-0003",
      "INV-0004",
      "INV-0005",
    ]);
  });
});
