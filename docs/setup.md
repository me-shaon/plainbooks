# Setup guide: first deploy

This guide sets up the app on a new Cloudflare account. It uses the Workers Free plan, the Zero Trust Free plan, and the Resend free plan.

In this guide, `invoices.example.com` is the host for the app and `example.com` is your domain. Replace both with your own values.

## Before you start

You need:

- A Cloudflare account.
- A domain that you control.
- A Resend account.
- Node.js 22.12 or later and pnpm on your computer.
- This repository, with `pnpm install` done.

Sign in to Cloudflare from the terminal:

```sh
pnpm wrangler login
```

## 1. Add the domain to Cloudflare

1. In the Cloudflare dashboard, select **Add a domain** and enter `example.com`.
2. Select the Free plan.
3. At your registrar, change the nameservers to the two nameservers that Cloudflare shows.
4. Wait until the domain status is **Active**.

Cloudflare Access and the custom domain both need the domain to be active on Cloudflare.

## 2. Create the D1 database

1. Create the database:

   ```sh
   pnpm wrangler d1 create plainbooks
   ```

2. Copy the `database_id` from the output.
3. In `wrangler.jsonc`, replace the placeholder `database_id` with that value.

Do not change the binding name `DB` or the `migrations_dir`.

## 3. Create the R2 bucket

1. Create the bucket:

   ```sh
   pnpm wrangler r2 bucket create plainbooks-files
   ```

2. If you use another bucket name, put it in `bucket_name` in `wrangler.jsonc`.

The bucket stores logos and cached PDFs. It stays private. The Worker serves the files.

## 4. Set the custom domain

1. In `wrangler.jsonc`, find the `routes` entry.
2. Replace `invoices.example.com` with your host.
3. Keep `"workers_dev": false` and `"preview_urls": false`.

The Worker runs only on the custom domain. A `workers.dev` URL would skip Cloudflare Access, so the config turns it off. The first `pnpm deploy` creates the DNS record and the certificate for the host.

## 5. Set the variables

Edit `vars` in `wrangler.jsonc`:

| Variable | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Your Zero Trust team domain, for example `your-team.cloudflareaccess.com`. You get it in step 7. |
| `ACCESS_AUD` | The Application Audience (AUD) tag of Access application 1. You get it in step 8. |
| `OWNER_EMAIL` | The email of the first Owner. Use lowercase. |
| `APP_URL` | `https://invoices.example.com`, with no trailing slash. Email links use it. The API refuses writes from a browser page on any other origin. |
| `APP_ENV` | `production`. Do not change it. |

Do not put `DEV_USER_EMAIL` or `FAKE_EXTERNALS` in the production config. The Worker ignores both when `APP_ENV` is `production`.

## 6. Deploy the Worker

1. Run the deploy:

   ```sh
   pnpm deploy
   ```

   This builds the app, applies the D1 migrations to the remote database, and deploys the Worker.

2. Set the Resend secrets. You get the values in step 10. You can set them now with placeholder values and change them later:

   ```sh
   pnpm wrangler secret put RESEND_API_KEY
   pnpm wrangler secret put RESEND_WEBHOOK_SECRET
   ```

Do not open the app yet. Until Access is in front of it, every API request gets a 401 error.

## 7. Turn on Cloudflare Zero Trust

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Choose a team name and select the Free plan.
3. Copy the team domain, for example `your-team.cloudflareaccess.com`.
4. Put it in `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`.
5. Make sure that a login method is on. The default **One-time PIN** sends a code by email. That is enough.

## 8. Create the Access applications

You create three self-hosted applications. Access uses the most specific matching application, so applications 2 and 3 override application 1 for their paths.

### Application 1: the whole app

1. Go to **Access** > **Applications** and select **Add an application**.
2. Select **Self-hosted**.
3. Name: `PlainBooks`.
4. Add the public hostname `invoices.example.com`. Leave the path empty.
5. Add a policy named `Team` with the action **Allow**.
6. Add an include rule **Emails** with the email of each team member. You can use **Emails ending in** `@example.com` instead.
7. Open **Settings** > **Cookies** and set **SameSite attribute** to **Lax**. Then the browser does not send the Access cookie on cross-site writes.
8. Save the application.
9. Open the application again and copy the **Application Audience (AUD) Tag**.
10. Put the tag in `ACCESS_AUD` in `wrangler.jsonc`.

The Worker checks the Access JWT on every API request. It checks the AUD tag and the team domain, so a token for another application is rejected.

The Worker also refuses cross-site writes. A POST, PATCH, PUT, or DELETE request gets a 403 error when the browser marks it as cross-site, or when its `Origin` header is not the origin of `APP_URL`. JSON bodies must use the `application/json` content type. The Resend webhook path is exempt from these checks.

### Application 2: public document links

1. Add another self-hosted application named `PlainBooks public links`.
2. Add the public hostname `invoices.example.com` with the path `p/*`.
3. Add a policy named `Public` with the action **Bypass**.
4. Add an include rule **Everyone**.
5. Save the application.

Clients open quotes and invoices at `/p/<token>`. The fonts, CSS, and logos for these pages are under `/p/assets/`, so this application also covers them.

### Application 3: the Resend webhook

1. Add another self-hosted application named `PlainBooks Resend webhook`.
2. Add the public hostname `invoices.example.com` with the path `api/webhooks/resend`. Do not add a wildcard.
3. Add a policy named `Resend` with the action **Bypass**.
4. Add an include rule **Everyone**.
5. Save the application.

The webhook route checks the Svix signature from Resend instead of an Access JWT. A request with a bad signature gets a 400 error.

### Deploy again

Deploy with the new `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` values:

```sh
pnpm deploy
```

## 9. Sign in for the first time

1. Open `https://invoices.example.com`.
2. Sign in through Access with the `OWNER_EMAIL` address.
3. The app creates your user as the Owner.

The bootstrap works only once. It runs when the users table is empty and the email is `OWNER_EMAIL`. Any other email gets a 403 error until an Owner adds it.

Then open **Settings** and check the workspace name, home currency, time zone, and number prefixes. The home currency locks after the first invoice is sent.

## 10. Set up Resend

### Verify the sending domain

1. In Resend, open **Domains** and select **Add domain**.
2. Enter `example.com`, or a subdomain such as `mail.example.com`.
3. Add the DNS records that Resend shows in the Cloudflare DNS dashboard:
   - The SPF records: an MX record and a TXT record on the `send` subdomain.
   - The DKIM record: a TXT record at `resend._domainkey`.
4. Set the proxy status of each record to **DNS only**.
5. In Resend, select **Verify DNS records**. Wait until the domain shows **Verified**.
6. Optional: add a DMARC record. A TXT record at `_dmarc` with the value `v=DMARC1; p=none;` is a safe start.

Automatic sends and reminders work only after Resend verifies the domain.

### Create the API key

1. In Resend, open **API Keys** and create a key with **Sending access**.
2. Set it as a secret:

   ```sh
   pnpm wrangler secret put RESEND_API_KEY
   ```

### Set the sender in the app

1. In the app, open **Settings**.
2. Set **Sender email** to an address on the verified domain, for example `billing@example.com`.
3. Optional: set **Sender name** and **Reply-to email**.
4. Save.

The app does not send email until the sender email is set.

### Create the webhook

1. In Resend, open **Webhooks** and select **Add webhook**.
2. Endpoint URL: `https://invoices.example.com/api/webhooks/resend`.
3. Select the events `email.bounced` and `email.complained`.
4. Save the webhook.
5. Copy the signing secret. It starts with `whsec_`.
6. Set it as a secret:

   ```sh
   pnpm wrangler secret put RESEND_WEBHOOK_SECRET
   ```

7. Send a test event from the Resend dashboard. The webhook must answer with status 200.

Secrets take effect without a new deploy.

## 11. Check Browser Run

The `BROWSER` binding needs no setup on the Free plan. Check it once after the deploy:

1. Create a client with your own email as the contact.
2. Create a quote for that client and send it.
3. Open the quote in the app and select **Download PDF**.
4. Open the PDF and check the layout, fonts, and logo.

The first PDF can take some seconds. If the app shows that the PDF is being prepared, wait 10 seconds and try again.

You can also check the binding before real use with `pnpm build` and then `pnpm wrangler dev --remote`. This runs the built Worker on Cloudflare with the real bindings. It uses the production D1 database and R2 bucket, so do not use it after you have real data.

## 12. Add team members

You must add each member in two places:

1. In the app, open **Settings** > **Team** and select **Add member**. Enter the email and choose the role, **Owner** or **Member**.
2. In Zero Trust, open Access application 1. Add the email to the `Team` policy. Skip this step if the policy uses **Emails ending in** and the email matches.

To remove a member, remove the email from the app and from the Access policy. The app does not let you remove the last Owner.

## Free-tier limits

| Service | Free limit | What happens at the limit |
| --- | --- | --- |
| Workers requests | 100,000 per day, reset at 00:00 UTC | Cloudflare shows error 1027 until the reset. |
| Workers CPU time | 10 ms per request | The request fails. The app keeps each request small. |
| Workers subrequests | 50 per request (each D1 statement counts) | The request fails. The scheduler counts its D1 statements and claims a job only when the budget can pay for it. A document send uses about 45 statements, so the :15, :30, and :45 ticks each run one send and nothing else. The :00 tick queues new work and runs small jobs. |
| Cron Triggers | 5 per account | The app uses 1 trigger, every 15 minutes. |
| D1 rows read | 5 million per day, reset at 00:00 UTC | Queries fail with an error until the reset. |
| D1 rows written | 100,000 per day, reset at 00:00 UTC | Queries fail with an error until the reset. |
| D1 storage | 500 MB per database, 5 GB per account | Inserts fail. Delete old data or upgrade. |
| R2 | 10 GB-month storage, 1 million Class A and 10 million Class B operations per month | Usage above the free amount needs a paid plan. |
| Browser Run | 10 minutes of browser time per day, 1 Quick Action every 10 seconds | The app shows "The PDF is being prepared". Try again later. Cached PDFs still download. |
| Resend | 100 emails per day, 3,000 per month | The app stops at 100 emails per day. Manual sends show an error. Scheduled sends wait until 00:05 the next day in the workspace time zone. |
| Zero Trust | 50 users | Members above 50 cannot sign in. |

The expected use is fewer than 100 invoices per month and fewer than 10 users. This is far below each limit.

## Backups

Export the D1 database to a SQL file:

```sh
pnpm wrangler d1 export plainbooks --remote --output=backup-$(date +%F).sql
```

Keep the file in a safe place. It contains client data. D1 Time Travel also keeps 7 days of history on the Free plan.

## Troubleshooting

### A client gets a 403 error or an Access login page on a public link

1. Open Access application 2 and check the path. It must be `p/*` on the same host as the app.
2. Check that the policy action is **Bypass** and the include rule is **Everyone**.
3. Check that the link starts with `APP_URL`. A link on another host does not match the application.
4. Wait a minute after you save the application, then try again in a private browser window.

### The Resend webhook fails

- A 302 or 403 response means Access blocks the request. Check Access application 3 and its exact path `api/webhooks/resend`.
- A 400 response with `invalid_signature` means that `RESEND_WEBHOOK_SECRET` does not match the signing secret of the webhook.

### The PDF stays "being prepared"

- Only one Quick Action can run every 10 seconds. Wait and try again.
- After 10 minutes of browser time in one day, Browser Run refuses new PDFs until 00:00 UTC. Cached PDFs still download.
- Check the Worker logs in the Cloudflare dashboard for the Browser Run error.

### Emails do not send

1. Open **Settings** and check that the sender email is set and is on the verified domain.
2. In Resend, check that the domain status is **Verified**.
3. Check that `RESEND_API_KEY` is set: `pnpm wrangler secret list`.
4. Check the daily limit. After 100 emails in one day, the app waits until the next day.
5. Open the document activity. A **Send failed** entry shows the error from Resend.

### Error 1027

The Worker used all 100,000 free requests for the day. Requests work again after 00:00 UTC. If this happens often, check for a script or bot that calls the app, or upgrade to the Workers Paid plan.

### Every page shows "Sign in through Cloudflare Access"

The request reached the Worker without an Access JWT. Check that Access application 1 covers the host. Check that `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` match the values in Zero Trust, then run `pnpm deploy` again.

### You get a 403 error after sign-in

If the error code is `cross_site_request`, the page origin is not the origin of `APP_URL`. Set `APP_URL` to the host in the address bar, then run `pnpm deploy` again.

Otherwise, your email is not in the users table. The first Owner must sign in with `OWNER_EMAIL`. Other members must be added on the Team page.
