#!/usr/bin/env node
/**
 * `pnpm run ship`: deploys PlainBooks from this machine in one command.
 *
 * The first run asks for your host, then creates the D1 database and the R2 bucket. It saves
 * the answers in `.deploy.env` and writes `wrangler.production.jsonc`. Both files are
 * git-ignored, so the tracked `wrangler.jsonc` stays a template.
 * Each run then builds, applies the remote D1 migrations, deploys, and sets APP_URL as a
 * Worker secret. When SETUP_TOKEN, AUTH_SECRET, or ENCRYPTION_KEY is not set, the script
 * makes a random value and sets it. It never replaces a secret that exists. It prints a new
 * setup token once, with the /setup URL, and records SETUP_TOKEN_ISSUED=1 in `.deploy.env`.
 * After that, it does not make a new setup token, so you can delete the secret after setup. These values are secrets, not vars, so a later
 * deploy from another machine or from Git does not reset them.
 *
 * Values in the environment win over `.deploy.env`. Set them to run without prompts in CI.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const SETTINGS_FILE = ".deploy.env";
const PROD_CONFIG = "wrangler.production.jsonc";
/** Secrets that the script makes when they are missing: 32 random bytes as base64. */
const GENERATED_SECRETS = ["SETUP_TOKEN", "AUTH_SECRET", "ENCRYPTION_KEY"];

const PROMPTS = [
  { key: "APP_HOST", question: "Host for the app, for example invoices.example.com" },
];

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

/** Runs a command with the terminal attached. Stops the script when it fails. */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed.`);
}

function runWrangler(args) {
  run("pnpm", ["exec", "wrangler", ...args]);
}

/** Runs wrangler and returns stdout. Returns null when the command fails. */
function wrangler(args) {
  try {
    return execFileSync("pnpm", ["exec", "wrangler", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** Removes `//` and `/* *\/` comments outside strings. wrangler.jsonc has no trailing commas. */
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += char;
    }
  }
  return JSON.parse(out);
}

function readSettings() {
  const settings = {};
  if (existsSync(SETTINGS_FILE)) {
    for (const line of readFileSync(SETTINGS_FILE, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) settings[match[1]] = match[2];
    }
  }
  for (const key of [...PROMPTS.map((p) => p.key), "D1_DATABASE_ID"]) {
    if (process.env[key]) settings[key] = process.env[key];
  }
  return settings;
}

function writeSettings(settings) {
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  writeFileSync(
    SETTINGS_FILE,
    `# Written by \`pnpm run ship\`. Not committed.\n${lines.join("\n")}\n`,
  );
}

async function askMissing(settings) {
  const missing = PROMPTS.filter((p) => settings[p.key] === undefined);
  if (missing.length === 0) return;
  if (!process.stdin.isTTY) {
    const required = missing.filter((p) => !p.optional).map((p) => p.key);
    if (required.length) fail(`Set ${required.join(", ")} in ${SETTINGS_FILE} or the environment.`);
    for (const prompt of missing) settings[prompt.key] = "";
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const prompt of missing) {
    let answer = "";
    while (!answer) {
      answer = (await rl.question(`${prompt.question}: `)).trim();
      if (prompt.optional) break;
    }
    settings[prompt.key] = answer;
  }
  rl.close();
}

function ensureLogin() {
  step("Checking the Cloudflare login");
  const whoami = wrangler(["whoami"]);
  if (whoami === null || /not authenticated/i.test(whoami)) runWrangler(["login"]);
}

function ensureDatabase(settings, name) {
  if (settings.D1_DATABASE_ID) return;
  step(`Finding or creating the D1 database "${name}"`);
  const list = wrangler(["d1", "list", "--json"]);
  if (list === null) fail("Could not list the D1 databases.");
  let database = JSON.parse(list).find((db) => db.name === name);
  if (!database) {
    if (wrangler(["d1", "create", name]) === null)
      fail(`Could not create the D1 database ${name}.`);
    database = JSON.parse(wrangler(["d1", "list", "--json"]) ?? "[]").find(
      (db) => db.name === name,
    );
    if (!database) fail(`Created the D1 database ${name}, but could not read its ID.`);
  }
  settings.D1_DATABASE_ID = database.uuid;
}

function ensureBucket(name) {
  step(`Finding or creating the R2 bucket "${name}"`);
  if (wrangler(["r2", "bucket", "info", name]) !== null) return;
  if (wrangler(["r2", "bucket", "create", name]) === null)
    fail(`Could not create the R2 bucket ${name}.`);
}

function writeProductionConfig(template, settings) {
  const config = structuredClone(template);
  delete config.$schema;
  config.routes = [{ pattern: settings.APP_HOST, custom_domain: true }];
  config.d1_databases = config.d1_databases.map((db) =>
    db.binding === "DB" ? { ...db, database_id: settings.D1_DATABASE_ID } : db,
  );
  config.vars = { ...config.vars, APP_ENV: "production" };
  writeFileSync(
    PROD_CONFIG,
    `// Written by \`pnpm run ship\` from wrangler.jsonc and ${SETTINGS_FILE}. Do not edit.\n${JSON.stringify(config, null, 2)}\n`,
  );
}

/** The names of the Worker secrets that exist. Stops the script when it cannot read them. */
function existingSecrets() {
  const list = wrangler(["secret", "list", "--format", "json", "-c", PROD_CONFIG]);
  if (list === null) fail("Could not list the Worker secrets. No secret was changed.");
  return new Set(JSON.parse(list).map((secret) => secret.name));
}

/**
 * Sets APP_URL, and a random value for each generated secret that is missing. Returns the
 * names of the secrets that it made and the new setup token, if it made one.
 */
function syncSecrets(settings) {
  const existing = existingSecrets();
  const values = { APP_URL: `https://${settings.APP_HOST}` };
  const created = [];
  for (const name of GENERATED_SECRETS) {
    if (existing.has(name)) continue;
    // A deleted setup token stays deleted. For Owner recovery, set a new one by hand.
    if (name === "SETUP_TOKEN" && settings.SETUP_TOKEN_ISSUED === "1") continue;
    values[name] = randomBytes(32).toString("base64");
    created.push(name);
  }
  const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "bulk", "-c", PROD_CONFIG], {
    input: JSON.stringify(values),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) fail("Could not set the Worker secrets.");
  return { created, setupToken: values.SETUP_TOKEN };
}

async function main() {
  const template = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
  const settings = readSettings();

  await askMissing(settings);
  settings.APP_HOST = settings.APP_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  ensureLogin();
  ensureDatabase(settings, template.d1_databases.find((db) => db.binding === "DB").database_name);
  ensureBucket(template.r2_buckets.find((bucket) => bucket.binding === "BUCKET").bucket_name);
  writeSettings(settings);
  writeProductionConfig(template, settings);

  step("Building");
  run("pnpm", ["run", "build"], { WRANGLER_CONFIG: PROD_CONFIG });

  step("Applying the D1 migrations to the remote database");
  runWrangler(["d1", "migrations", "apply", "DB", "--remote", "-c", PROD_CONFIG]);

  step("Deploying the Worker");
  runWrangler(["deploy"]);

  step("Setting APP_URL and the missing secrets");
  const { created, setupToken } = syncSecrets(settings);
  if (created.length) console.log(`  Made and set ${created.join(", ")}.`);
  if (setupToken) {
    settings.SETUP_TOKEN_ISSUED = "1";
    writeSettings(settings);
  }

  console.log(`\n✔ Deployed to https://${settings.APP_HOST}`);
  if (setupToken) {
    console.log(
      `\n  Setup token (shown once, not saved on this computer):\n\n    ${setupToken}\n\n` +
        `  Open https://${settings.APP_HOST}/setup and enter it to create the first Owner.\n` +
        `  After setup, delete the secret: pnpm exec wrangler secret delete SETUP_TOKEN -c ${PROD_CONFIG}`,
    );
  }
}

await main();
