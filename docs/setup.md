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

## 2. Deploy the Worker

You can deploy from your computer with the deploy script, or from the Cloudflare dashboard with the Deploy button. Do one of the two.

### Option A: the deploy script

1. Run the script:

   ```sh
   pnpm run ship
   ```

2. Answer the questions:

   | Question | Answer |
   | --- | --- |
   | Host for the app | `invoices.example.com`. |
   | Email of the first Owner | Your email. The script changes it to lowercase. |
   | Zero Trust team domain | Leave it empty. You get it in step 3. |
   | Access application AUD tag | Leave it empty. You get it in step 4. |

3. When the script asks for `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, type a placeholder value. You get the real values in step 6 of this guide.

The script does these steps:

1. It signs you in to Cloudflare if necessary.
2. It finds or creates the D1 database `plainbooks` and the R2 bucket `plainbooks-files`.
3. It saves your answers and the database ID in `.deploy.env`.
4. It writes `wrangler.production.jsonc` from `wrangler.jsonc` and `.deploy.env`.
5. It builds the app, applies the D1 migrations to the remote database, and deploys the Worker.
6. It asks for each Resend secret that is not set.

Git ignores `.deploy.env` and `wrangler.production.jsonc`. The tracked `wrangler.jsonc` keeps its placeholder values. Do not edit `wrangler.production.jsonc`. To change a value, edit `.deploy.env` and run `pnpm run ship` again.

The Worker runs only on the custom domain. A `workers.dev` URL would skip Cloudflare Access, so the config turns it off. The first deploy creates the DNS record and the certificate for the host.

### Option B: the Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/me-shaon/plainbooks)

1. Select the button.
2. Connect your GitHub or GitLab account. Cloudflare copies this repository to a new repository in your account.
3. Keep the new D1 database and the new R2 bucket that Cloudflare suggests.
4. Set `OWNER_EMAIL` to your email in lowercase.
5. Set `APP_URL` to `https://invoices.example.com`, with no trailing slash.
6. Type a placeholder value for `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. You get the real values in step 6 of this guide.
7. Select **Deploy**.
8. In the dashboard, open the Worker, then go to **Settings** > **Domains & Routes**. Add the custom domain `invoices.example.com`.

The Worker has no URL until you add the custom domain. This is intentional: a `workers.dev` URL would skip Cloudflare Access.

Each push to the new repository deploys again. Change the variables in `wrangler.jsonc` in the new repository, not in the dashboard. A deploy replaces the variables that you set in the dashboard.

To change a secret, open the Worker in the dashboard and go to **Settings** > **Variables and Secrets**.

Do not open the app yet. Until Access is in front of it, every API request gets a 401 error.

## 3. Turn on Cloudflare Zero Trust

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Choose a team name and select the Free plan.
3. Copy the team domain, for example `your-team.cloudflareaccess.com`.
4. Keep the value. You use it in "Deploy again" in step 4.
5. Make sure that a login method is on. The default **One-time PIN** sends a code by email. That is enough.

## 4. Create the Access applications

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
10. Keep the tag. You use it in "Deploy again" below.

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

Deploy with the team domain and the AUD tag.

If you used the deploy script:

1. In `.deploy.env`, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
2. Run the script:

   ```sh
   pnpm run ship
   ```

If you used the Deploy button:

1. In your new repository, open `wrangler.jsonc`.
2. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `vars`.
3. Commit and push. The push deploys the Worker.

## 5. Sign in for the first time

1. Open `https://invoices.example.com`.
2. Sign in through Access with the `OWNER_EMAIL` address.
3. The app creates your user as the Owner.

The bootstrap works only once. It runs when the users table is empty and the email is `OWNER_EMAIL`. Any other email gets a 403 error until an Owner adds it.

Then open **Settings** and check the workspace name, home currency, time zone, and number prefixes. The home currency locks after the first invoice is sent.

## 6. Set up Resend

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

## 7. Check Browser Run

The `BROWSER` binding needs no setup on the Free plan. Check it once after the deploy:

1. Create a client with your own email as the contact.
2. Create a quote for that client and send it.
3. Open the quote in the app and select **Download PDF**.
4. Open the PDF and check the layout, fonts, and logo.

The first PDF can take some seconds. If the app shows that the PDF is being prepared, wait 10 seconds and try again.

You can also check the binding before real use with `pnpm build` and then `pnpm wrangler dev --remote`. This runs the built Worker on Cloudflare with the real bindings. It uses the production D1 database and R2 bucket, so do not use it after you have real data.

## 8. Add team members

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

The request reached the Worker without an Access JWT. Check that Access application 1 covers the host. Check that `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` match the values in Zero Trust. Then deploy again as in step 4.

### You get a 403 error after sign-in

If the error code is `cross_site_request`, the page origin is not the origin of `APP_URL`. Set `APP_URL` to the host in the address bar. Then deploy again as in step 4. The deploy script sets `APP_URL` from `APP_HOST` in `.deploy.env`.

Otherwise, your email is not in the users table. The first Owner must sign in with `OWNER_EMAIL`. Other members must be added on the Team page.
