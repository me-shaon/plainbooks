import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../src/shared/schemas/settings";
import { createDb, schema } from "../../src/worker/db/client";
import { releaseFetcher } from "../../src/worker/externals";
import { runTick } from "../../src/worker/services/scheduler";
import {
  fetchLatestRelease,
  isNewerVersion,
  parseVersion,
  UPDATE_CHECK_JOB,
  UPSTREAM_REPO,
} from "../../src/worker/services/updates";
import { APP_VERSION } from "../../src/worker/version";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";

const db = createDb(env.DB);
const OWNER = "owner@updates.test";
const MEMBER = "member@updates.test";
/** 00:00 UTC, a tick that runs the enqueue phase. */
const DAY_1 = Date.parse("2026-10-23T00:00:00Z");
const DAY_2 = Date.parse("2026-10-24T00:00:00Z");
const RELEASES_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`;

function release(tag: string): Response {
  return Response.json({
    tag_name: tag,
    html_url: `https://github.com/${UPSTREAM_REPO}/releases/tag/${tag}`,
  });
}

/** Answers the GitHub releases URL with `respond` and counts the calls. */
function stubGitHub(respond: () => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url !== RELEASES_URL) throw new Error(`Unexpected fetch: ${url}`);
    return respond();
  });
  return calls;
}

async function workspaceRow() {
  const [row] = await db.select().from(schema.workspace).where(eq(schema.workspace.id, 1));
  return row;
}

async function updateNotifications() {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.type, "update_available"));
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM notifications"),
    env.DB.prepare(
      `UPDATE workspace SET update_check = 1, latest_version = NULL, latest_release_url = NULL,
       update_checked_at = NULL WHERE id = 1`,
    ),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versions", () => {
  it("reads versions with and without the v prefix", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("v1.2")).toBeNull();
    expect(parseVersion("v1.2.3-beta.1")).toBeNull();
  });

  it("has a release version in src/worker/version.ts", () => {
    // release.yml and update.yml read this exact format.
    expect(parseVersion(APP_VERSION)).not.toBeNull();
  });

  it("compares each part as a number", () => {
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
    expect(isNewerVersion("main", "0.2.0")).toBe(false);
  });
});

describe("fetchLatestRelease", () => {
  it("returns null when the repository has no release", async () => {
    stubGitHub(() => Response.json({ message: "Not Found" }, { status: 404 }));
    expect(await fetchLatestRelease(fetch)).toBeNull();
  });

  it("returns the version without the v prefix", async () => {
    stubGitHub(() => release("v0.3.1"));
    expect(await fetchLatestRelease(fetch)).toEqual({
      version: "0.3.1",
      url: `https://github.com/${UPSTREAM_REPO}/releases/tag/v0.3.1`,
    });
  });

  it("throws for a refused request or a tag that is not a version", async () => {
    stubGitHub(() => new Response("rate limited", { status: 403 }));
    await expect(fetchLatestRelease(fetch)).rejects.toThrow("403");
    vi.restoreAllMocks();
    stubGitHub(() => release("nightly"));
    await expect(fetchLatestRelease(fetch)).rejects.toThrow("nightly");
  });

  it("uses the fake with no releases in development with FAKE_EXTERNALS=1", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const fetcher = releaseFetcher({ APP_ENV: "development", FAKE_EXTERNALS: "1" });
    expect(await fetchLatestRelease(fetcher)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the daily check", () => {
  it("records a newer release and notifies the Owner once per version", async () => {
    const calls = stubGitHub(() => release("v99.0.0"));

    await runTick(env, DAY_1);
    // The other enqueue phases of the day do not queue a second check.
    await runTick(env, DAY_1 + 60 * 60 * 1000);
    expect(calls).toHaveLength(1);
    const row = await workspaceRow();
    expect(row?.latestVersion).toBe("99.0.0");
    expect(row?.latestReleaseUrl).toBe(`https://github.com/${UPSTREAM_REPO}/releases/tag/v99.0.0`);
    expect(row?.updateCheckedAt).toBe(DAY_1);
    const [note, ...rest] = await updateNotifications();
    expect(rest).toHaveLength(0);
    expect(note?.title).toBe("Plainbooks 99.0.0 is available");
    expect(note?.body).toContain(`version ${APP_VERSION}`);

    // The next day finds the same version: no second notification.
    await runTick(env, DAY_2);
    expect(calls).toHaveLength(2);
    expect(await updateNotifications()).toHaveLength(1);
  });

  it("does not notify for the running version", async () => {
    stubGitHub(() => release(`v${APP_VERSION}`));
    await runTick(env, DAY_1);
    expect((await workspaceRow())?.latestVersion).toBe(APP_VERSION);
    expect(await updateNotifications()).toHaveLength(0);
  });

  it("finishes the job quietly when GitHub fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGitHub(() => new Response("unavailable", { status: 503 }));
    await runTick(env, DAY_1);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, UPDATE_CHECK_JOB));
    expect(job?.status).toBe("done");
    expect((await workspaceRow())?.updateCheckedAt).toBeNull();
    // No "job failed" notification either.
    expect(await db.select().from(schema.notifications)).toHaveLength(0);
  });

  it("does not ask GitHub when the Owner turned the check off", async () => {
    await env.DB.prepare("UPDATE workspace SET update_check = 0 WHERE id = 1").run();
    const calls = stubGitHub(() => release("v99.0.0"));
    await runTick(env, DAY_1);
    expect(calls).toHaveLength(0);
    expect(
      await db.select().from(schema.jobs).where(eq(schema.jobs.type, UPDATE_CHECK_JOB)),
    ).toHaveLength(0);
  });
});

describe("/api/settings/updates", () => {
  beforeEach(async () => {
    await clearUsers();
    await seedUser(OWNER, "owner");
    await seedUser(MEMBER, "member");
  });

  it("shows the Owner the running version and the newest release", async () => {
    await env.DB.prepare(
      "UPDATE workspace SET latest_version = '99.0.0', latest_release_url = 'https://github.com/x', update_checked_at = 5 WHERE id = 1",
    ).run();
    const res = await apiFetch("/api/settings/updates", { as: OWNER });
    expect(res.status).toBe(200);
    expect((await res.json()) as UpdateStatus).toEqual({
      enabled: true,
      currentVersion: APP_VERSION,
      latestVersion: "99.0.0",
      releaseUrl: "https://github.com/x",
      updateAvailable: true,
      checkedAt: 5,
    });
  });

  it("lets only the Owner read or change it", async () => {
    expect((await apiFetch("/api/settings/updates", { as: MEMBER })).status).toBe(403);
    const res = await apiFetch("/api/settings/updates", {
      as: MEMBER,
      method: "PATCH",
      json: { enabled: false },
    });
    expect(res.status).toBe(403);
    expect((await workspaceRow())?.updateCheck).toBe(true);
  });

  it("turns the check off and on", async () => {
    const off = await apiFetch("/api/settings/updates", {
      as: OWNER,
      method: "PATCH",
      json: { enabled: false },
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as UpdateStatus).enabled).toBe(false);
    expect((await workspaceRow())?.updateCheck).toBe(false);

    const bad = await apiFetch("/api/settings/updates", {
      as: OWNER,
      method: "PATCH",
      json: { enabled: "yes" },
    });
    expect(bad.status).toBe(400);
  });
});
