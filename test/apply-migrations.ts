import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files can run more than once. applyD1Migrations() skips applied migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The daily update check would ask the real GitHub API from the scheduler tests.
// test/services/updates.test.ts turns it on with a stub.
await env.DB.prepare("UPDATE workspace SET update_check = 0 WHERE id = 1").run();
