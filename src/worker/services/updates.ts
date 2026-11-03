// The update check. Once a day the scheduler asks GitHub for the newest release of the
// upstream repository. A newer version than APP_VERSION shows in Settings > General, and
// the Owner gets one notification per new version. The Owner can turn the check off.
import { eq } from "drizzle-orm";
import type { UpdateStatus } from "../../shared/schemas/settings";
import { type Db, schema } from "../db/client";
import type { Workspace } from "../db/schema";
import type { Bindings } from "../env";
import { AppError } from "../errors";
import { releaseFetcher } from "../externals";
import { APP_VERSION } from "../version";
import type { Fetcher } from "./fx";
import { type BatchStatement, registerEnqueueHook, registerJobHandler } from "./jobs";
import { forgetWorkspace, loadWorkspace } from "./settings";

const { workspace, notifications } = schema;

/** The repository that publishes the releases. Copies made by the Deploy button check it too. */
export const UPSTREAM_REPO = "me-shaon/plainbooks";
export const UPDATE_CHECK_JOB = "check_update";
const RELEASE_TIMEOUT_MS = 10_000;

export interface Release {
  /** Without the "v" prefix, for example "0.2.0". */
  version: string;
  url: string;
}

/** "v1.2.3" or "1.2.3" as [1, 2, 3]. Null for any other text. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a higher version than `current`. False when either is not valid. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The release from a tag and its page URL. Throws when the tag is not a version. */
function releaseOf(tag: string, url: string): Release {
  const parsed = parseVersion(tag);
  if (!parsed || !url.startsWith("https://github.com/")) {
    throw new Error(`GitHub sent a release with the tag "${tag.slice(0, 40)}"`);
  }
  return { version: parsed.join("."), url };
}

/** The newest release from the GitHub API. Null when the repository has no release. */
async function fetchFromApi(fetcher: Fetcher): Promise<Release | null> {
  const res = await fetcher(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": `plainbooks/${APP_VERSION}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
  return releaseOf(
    typeof body.tag_name === "string" ? body.tag_name : "",
    typeof body.html_url === "string" ? body.html_url : "",
  );
}

/**
 * The newest release from the redirect of the public "latest release" page. It does not
 * count against the API limit. With no release, GitHub redirects to the release list.
 */
async function fetchFromReleasePage(fetcher: Fetcher): Promise<Release | null> {
  const res = await fetcher(`https://github.com/${UPSTREAM_REPO}/releases/latest`, {
    method: "HEAD",
    headers: { "user-agent": `plainbooks/${APP_VERSION}` },
    redirect: "manual",
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) {
    throw new Error(`The release page answered ${res.status}`);
  }
  const url = new URL(location, "https://github.com").href;
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(new URL(url).pathname)?.[1];
  if (!tag) return null;
  return releaseOf(decodeURIComponent(tag), url);
}

/**
 * The newest published release. GitHub leaves out drafts and pre-releases. Null when the
 * repository has no release yet. Throws when GitHub does not answer or the answer is wrong.
 *
 * Without a token, the GitHub API allows 60 requests an hour per IP address, and Workers
 * share IP addresses, so the API often refuses with 403 or 429. The release page is then
 * the second source.
 */
export async function fetchLatestRelease(fetcher: Fetcher): Promise<Release | null> {
  try {
    return await fetchFromApi(fetcher);
  } catch (apiError) {
    try {
      return await fetchFromReleasePage(fetcher);
    } catch (pageError) {
      const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
      throw new Error(`${reason(apiError)}. ${reason(pageError)}.`);
    }
  }
}

/**
 * The statements that record a check. The Owner gets a notification only the first time a
 * version newer than this build shows.
 */
export function recordReleaseStatements(
  db: Db,
  ws: Pick<Workspace, "latestVersion">,
  release: Release | null,
  now: number,
): BatchStatement[] {
  const statements: BatchStatement[] = [
    db
      .update(workspace)
      .set({
        latestVersion: release?.version ?? null,
        latestReleaseUrl: release?.url ?? null,
        updateCheckedAt: now,
      })
      .where(eq(workspace.id, 1)),
  ];
  if (
    release &&
    release.version !== ws.latestVersion &&
    isNewerVersion(release.version, APP_VERSION)
  ) {
    statements.push(
      db.insert(notifications).values({
        type: "update_available",
        title: `Plainbooks ${release.version} is available`,
        body: `This app runs version ${APP_VERSION}. Read what changed at ${release.url}. To update, merge the update pull request in your repository, or follow docs/updating.md.`,
        createdAt: now,
      }),
    );
  }
  return statements;
}

/** What Settings > General shows. */
export function updateStatus(ws: Workspace): UpdateStatus {
  return {
    enabled: ws.updateCheck,
    currentVersion: APP_VERSION,
    latestVersion: ws.latestVersion,
    releaseUrl: ws.latestReleaseUrl,
    updateAvailable: ws.latestVersion !== null && isNewerVersion(ws.latestVersion, APP_VERSION),
    checkedAt: ws.updateCheckedAt,
  };
}

/**
 * The shortest time between two checks that an Owner starts. GitHub allows 60 API requests
 * an hour per IP address without a token, and Workers share IP addresses.
 */
export const MANUAL_CHECK_INTERVAL_MS = 60_000;

/**
 * Checks GitHub now, for the "Check now" button, and returns the new status. Within a
 * minute of the last check, it returns the stored result. It runs when the daily check is
 * off too, because the Owner asked for it.
 */
export async function checkForUpdateNow(
  env: Pick<Bindings, "APP_ENV" | "FAKE_EXTERNALS">,
  db: Db,
  now: number,
): Promise<UpdateStatus> {
  const ws = await loadWorkspace(db);
  if (ws.updateCheckedAt !== null && now - ws.updateCheckedAt < MANUAL_CHECK_INTERVAL_MS) {
    return updateStatus(ws);
  }
  let release: Release | null;
  try {
    release = await fetchLatestRelease(releaseFetcher(env));
  } catch (err) {
    console.warn("The update check failed", err);
    throw new AppError(
      502,
      "update_check_failed",
      "Could not reach GitHub. Try again in a few minutes.",
    );
  }
  const statements = recordReleaseStatements(db, ws, release, now);
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  forgetWorkspace(db);
  return updateStatus(await loadWorkspace(db));
}

// One job per day. The idempotency key stops the 24 enqueue phases of a day from adding more.
registerEnqueueHook("updates", ({ workspace: ws, today }) =>
  ws.updateCheck
    ? [{ type: UPDATE_CHECK_JOB, idempotencyKey: `${UPDATE_CHECK_JOB}:${today}`, maxAttempts: 1 }]
    : undefined,
);

registerJobHandler(UPDATE_CHECK_JOB, async ({ env, db, now }) => {
  const ws = await loadWorkspace(db);
  // Turned off after the job was queued.
  if (!ws.updateCheck) return undefined;
  let release: Release | null;
  try {
    release = await fetchLatestRelease(releaseFetcher(env));
  } catch (err) {
    // A failed check is not the Owner's problem. Tomorrow's job tries again.
    console.warn("The update check failed", err);
    return undefined;
  }
  forgetWorkspace(db);
  return { statements: recordReleaseStatements(db, ws, release, now) };
});
