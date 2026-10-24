# PlainBooks

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/me-shaon/plainbooks)

PlainBooks is a private invoicing app for one agency. It runs as a single Cloudflare Worker on the Workers Free plan. The team signs in through Cloudflare Access. Clients open quotes and invoices through public links and need no account.

## Features

- Clients with contacts, default currency, tax rate, payment terms, and template.
- Quotes that the client can accept or decline on a public page. An accepted quote converts to an invoice.
- Invoices with gap-free numbering, revisions, payments, write-offs, and void.
- Multi-currency documents. Each sent document stores its exchange rate to the home currency (from Frankfurter, or entered by hand).
- PDFs from Browser Run, cached in R2 per revision.
- Email delivery through Resend, with bounce and complaint webhooks.
- Recurring invoices that create drafts or send automatically.
- Payment reminders, suggested or automatic.
- A dashboard, notifications, tax, income, and aging reports, and CSV exports.
- A brand kit, three layouts, a template editor, and custom fields.
- Owner and Member roles.

## Stack

- Cloudflare Workers, D1 (SQLite), R2, Browser Run, and Cron Triggers.
- Hono and Drizzle ORM on the Worker.
- React 19, TanStack Router and Query, React Aria Components, and Tailwind CSS 4 in the browser.
- Vite with the Cloudflare Vite plugin.
- Vitest with `@cloudflare/vitest-plugin`, Playwright, and axe.
- Biome for lint and format. TypeScript in strict mode.

## Local development

You need Node.js 22.12 or later and pnpm.

1. Install the dependencies:

   ```sh
   pnpm install
   ```

2. Copy the local secrets:

   ```sh
   cp .dev.vars.example .dev.vars
   ```

3. Create the local D1 database and apply the migrations:

   ```sh
   pnpm db:migrate
   ```

4. Start the dev server:

   ```sh
   pnpm dev
   ```

5. Open the URL that Vite prints, for example `http://localhost:5173`.

### Dev auth bypass

Locally there is no Cloudflare Access in front of the app. The Worker signs you in as `DEV_USER_EMAIL` when all of these are true:

- `APP_ENV` is `development`. `pnpm dev` sets it. The build never does.
- The request host is `localhost` or `127.0.0.1`.
- `DEV_USER_EMAIL` is set. `pnpm dev` sets it to `owner@example.com`.

The first sign-in creates the Owner only when the email is `OWNER_EMAIL`. Both default to `owner@example.com`. To use another email, set `DEV_USER_EMAIL` in `.dev.vars` before the first sign-in. Also set `OWNER_EMAIL` there to the same value.

Local email, exchange rates, and PDFs call the real services. Put a real Resend key in `.dev.vars` to send email. Browser Run Quick Actions do not run locally, so PDF downloads fail in `pnpm dev`. To use fakes for all three, add `FAKE_EXTERNALS=1` to `.dev.vars`. The Worker ignores this flag unless `APP_ENV` is `development`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Starts Vite and the Worker locally. |
| `pnpm build` | Builds the web app and the Worker into `dist/`. |
| `pnpm preview` | Serves the build locally. |
| `pnpm typecheck` | Runs the TypeScript compiler on all projects. |
| `pnpm lint` | Runs Biome checks. |
| `pnpm format` | Applies Biome fixes and formatting. |
| `pnpm test` | Runs the Worker and web unit tests with Vitest. |
| `pnpm test:perf` | Runs the render benchmark. |
| `pnpm e2e` | Runs the Playwright smoke test and the axe checks. |
| `pnpm e2e:db` | Resets the end-to-end D1 database and applies the migrations. |
| `pnpm db:generate` | Generates a migration from `src/worker/db/schema.ts`. |
| `pnpm db:migrate` | Applies the migrations to the local D1 database. |
| `pnpm cf-typegen` | Generates `worker-configuration.d.ts` from `wrangler.jsonc`. |
| `pnpm run ship` | Deploys from your computer. The first run creates the D1 database and the R2 bucket and asks for your host. |
| `pnpm run deploy` | Builds, applies the remote D1 migrations, and deploys with `wrangler.jsonc` as it is. The Deploy button uses it. |

## Testing

- `pnpm test` runs two Vitest projects. The `worker` project runs `test/**/*.test.ts` in the Workers runtime with the migrations applied. The `web` project runs `src/**/*.test.{ts,tsx}` in happy-dom. Tests stub Resend, Frankfurter, and Browser Run.
- `pnpm test:perf` runs the render benchmark. It is skipped in `pnpm test`.
- `pnpm e2e` runs `e2e/smoke.spec.ts` in Chromium. Install the browser once with `pnpm exec playwright install chromium`.

The end-to-end test starts `vite` with `E2E=1` on port 5197. In this mode the Worker uses the dev auth bypass, fake external services, and a separate D1 database in `.wrangler/e2e`. The database is reset before each run. The test creates a client, sends a quote, accepts it on the public page, converts it, sends the invoice, records the payment, and checks the dashboard. It also runs axe on the dashboard, the invoice editor, and the public invoice page, and checks the public page at 390 px wide.

If your `.dev.vars` sets `APP_ENV`, `DEV_USER_EMAIL`, `OWNER_EMAIL`, `FAKE_EXTERNALS`, or the Resend values to other values, the end-to-end server stops with an error. Values in `.dev.vars` override the test values.

## Project layout

```
src/
  shared/        Code for the Worker and the browser: money, dates, schemas, domain types.
  worker/        The Worker.
    app.ts       The Hono app and route mounts.
    index.ts     The fetch and scheduled handlers.
    externals.ts Picks the real or fake Resend, Frankfurter, and Browser Run adapters.
    auth/        Access JWT verification and roles.
    db/          The Drizzle schema and client.
    email/       Email templates.
    render/      The HTML document renderer for pages and PDFs.
    routes/      API, public, render, and webhook routes.
    services/    Domain logic: documents, payments, email, PDF, jobs, recurring, reminders.
  web/           The React app.
    components/  The app shell and UI primitives.
    features/    Pages and components per feature.
    routes/      TanStack Router file routes.
migrations/      D1 migrations.
test/            Worker tests and helpers.
e2e/             Playwright tests.
docs/            Requirements, plan, and setup guide.
```

## Deploy

You can deploy in two ways:

- Select the **Deploy to Cloudflare** button at the top of this file. Cloudflare copies the repository to your GitHub or GitLab account, creates the D1 database and the R2 bucket, and deploys. Each push to your copy deploys again.
- Run `pnpm run ship` on your computer. The first run asks for your host and owner email, creates the D1 database and the R2 bucket, and deploys. Later runs only build, migrate, and deploy.

Both ways need Cloudflare Access and Resend set up by hand. Read [docs/setup.md](docs/setup.md) for each step.

Use `pnpm run deploy` or `pnpm run ship`, not `pnpm deploy`. `pnpm deploy` is a built-in pnpm command and does not run the script.
