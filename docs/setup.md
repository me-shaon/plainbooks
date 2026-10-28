# Setup guide: first deploy

This guide sets up the app on a new Cloudflare account. It uses the Workers Free plan and the free plan of an email provider. The guide uses toSend as the email provider, but you can choose another provider.

In this guide, `invoices.example.com` is the host for the app and `example.com` is your domain. Replace both with your own values.

## Before you start

You need:

- A Cloudflare account.
- A domain that you control.
- An account with an email provider. toSend is the default. You can set up email after the deploy.
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

The custom domain of the Worker needs the domain to be active on Cloudflare.

## 2. Deploy the Worker

You can deploy from your computer with the deploy script, or from the Cloudflare dashboard with the Deploy button. Do one of the two.

The Worker needs these secrets:

| Secret | What it does |
| --- | --- |
| `SETUP_TOKEN` | Opens the setup screen at `/setup`, where you create the first Owner. It must have 32 characters or more. Each value works once. |
| `AUTH_SECRET` | Signs the sign-in sessions. It must have 32 characters or more. |
| `ENCRYPTION_KEY` | Encrypts the email provider keys that you save in the app. It must be 32 random bytes as base64. |
| `APP_URL` | The public origin of the app, for example `https://invoices.example.com`. |
| `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` | Optional. They turn on Google sign-in. Step 7 tells you how to get them. |

### Option A: the deploy script

1. Run the script:

   ```sh
   pnpm run ship
   ```

2. When the script asks for the host for the app, enter `invoices.example.com`.
3. At the end, the script shows the setup token one time. Copy it. You use it in step 3.

The script does these steps:

1. It signs you in to Cloudflare if necessary.
2. It finds or creates the D1 database `plainbooks` and the R2 bucket `plainbooks-files`.
3. It saves your host and the database ID in `.deploy.env`.
4. It writes `wrangler.production.jsonc` from `wrangler.jsonc` and `.deploy.env`.
5. It builds the app, applies the D1 migrations to the remote database, and deploys the Worker.
6. It sets `APP_URL` from your host.
7. It makes a random value for each missing secret of `SETUP_TOKEN`, `AUTH_SECRET`, and `ENCRYPTION_KEY`, and sets it. It never replaces a secret that exists.

The script makes a setup token only one time. It then writes `SETUP_TOKEN_ISSUED=1` in `.deploy.env`. A later run does not make a new setup token, so you can delete the secret after setup.

Git ignores `.deploy.env` and `wrangler.production.jsonc`. The tracked `wrangler.jsonc` keeps its placeholder values. Do not edit `wrangler.production.jsonc`. To change a value, edit `.deploy.env` and run `pnpm run ship` again.

The Worker runs only on the custom domain. The config turns off the `workers.dev` URL. The first deploy creates the DNS record and the certificate for the host.

### Option B: the Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/me-shaon/plainbooks)

1. Make three random values. Run this command three times, and keep each value:

   ```sh
   openssl rand -base64 32
   ```

   Each value is 32 random bytes as base64. If you do not have `openssl`, use this command:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. Select the button.
3. Connect your GitHub or GitLab account. Cloudflare copies this repository to a new repository in your account.
4. Keep the new D1 database and the new R2 bucket that Cloudflare suggests.
5. Set `SETUP_TOKEN` to the first random value. Keep this value for step 3.
6. Set `AUTH_SECRET` to the second random value.
7. Set `ENCRYPTION_KEY` to the third random value.
8. Set `APP_URL` to `https://invoices.example.com`, with no trailing slash.
9. Select **Deploy**.
10. In the dashboard, open the Worker, then go to **Settings** > **Domains & Routes**. Add the custom domain `invoices.example.com`.

The Worker has no URL until you add the custom domain. This is intentional.

The Deploy button stores the values as Worker secrets. Each push to the new repository deploys again and keeps the secrets. To change a secret, open the Worker in the dashboard and go to **Settings** > **Variables and Secrets**.

## 3. Create the first Owner

1. Open `https://invoices.example.com/setup`. Until an Owner exists, every page of the app opens the setup screen.
2. Enter the setup token.
3. Enter your name, your email, and a password. The password must have 12 to 128 characters.
4. Select **Create Owner**. The app signs you in.

Setup works only one time. After the first Owner exists, the setup screen is closed. Wrong setup tokens are rate limited.

Then open **Settings** and check the workspace name, home currency, time zone, and number prefixes. The home currency locks after the first invoice is sent.

## 4. Delete the setup token

A used setup token never works again. Delete the secret anyway, so that setup and Owner recovery are turned off.

If you used the deploy script, run this command:

```sh
pnpm wrangler secret delete SETUP_TOKEN
```

If you used the Deploy button, open the Worker in the dashboard and go to **Settings** > **Variables and Secrets**. Delete `SETUP_TOKEN`.

You need a new setup token only to recover a locked-out Owner. Step 9 tells you how.

## 5. Set up email

The app sends quotes, invoices, reminders, invites, and password resets by email. Without an email provider, the app still works. Invites and password resets then give you a link to copy.

Only an Owner can change the email settings. They are in **Settings** > **Email**.

### Set the sender

1. In the app, open **Settings** > **General**.
2. Set **Sender email** to an address on your sending domain, for example `billing@example.com`.
3. Optional: set **Sender name** and **Reply-to email**.
4. Save.

The app does not send email until the sender email is set.

### Set up toSend

toSend is the default provider. The email settings select it for you.

Verify the sending domain:

1. In toSend, add your sending domain, for example `example.com` or `mail.example.com`.
2. Add the DNS records that toSend shows in the Cloudflare DNS dashboard.
3. Set the proxy status of each record to **DNS only**.
4. Wait until toSend shows that the domain is verified.
5. Optional: add a DMARC record. A TXT record at `_dmarc` with the value `v=DMARC1; p=none;` is a safe start.

Add the API key:

1. In toSend, create a sending key. An admin key must have the `emails:send` scope. The key starts with `tsend_`.
2. In the app, open **Settings** > **Email**.
3. In **Primary provider**, keep **toSend**.
4. Paste the key in **API key**.

Add the webhook. The webhook tells the app about bounces and complaints.

1. In **Settings** > **Email**, copy the **Webhook URL**. For the primary provider, it is `https://invoices.example.com/api/webhooks/email/primary`.
2. In toSend, create a webhook with this URL.
3. Select the bounce and complaint events.
4. Copy the signing secret of the webhook.
5. In the app, paste it in **Webhook secret**.
6. Save the provider.

Then send a test email:

1. In **Settings** > **Email**, select **Send test email**.
2. Check the inbox of your own address.

The app encrypts the API key and the webhook secret before it saves them. The settings page never shows a saved secret. To change a secret, enter the new value.

### Other providers

You can choose any provider in the list instead of toSend. The list includes Resend, Cloudflare Email (REST API), Mailgun, Postmark, Brevo, MailerSend, Mailjet, SMTP2GO, ZeptoMail, SendGrid, Amazon SES, SMTP, MailChannels, AhaSend, Mailtrap, AutoSend, Scaleway Transactional Email, and a generic HTTP provider. SMTP has presets for common services.

Each provider shows its own key fields. Each field has a hint that tells you where to find the value. For the webhook, use the webhook URL from the settings page.

Some providers need a value that you make yourself:

- **Postmark:** Make a random value of at least 22 characters. In Postmark, set the webhook Basic auth username to `mailswitch` and the password to this value.
- **Brevo and SMTP2GO:** Make a random value of at least 22 characters. Give it to the provider as the bearer token of the webhook.
- **Mailjet:** Make a random value of at least 22 characters. Put it in the webhook URL that you give Mailjet as the Basic auth password.
- **Amazon SES:** Enter the ARNs of the SNS topics that send the SES events. Subscribe the webhook URL to each topic as an HTTPS endpoint. The app confirms the subscription for you.

Some providers need a setting that is not a key:

- **MailChannels:** Enter the customer handle of your MailChannels account. The webhook refuses events for any other account.
- **Generic HTTP:** Use it for a JSON email API that the list does not have. Enter the JSON config of the API, and the token in the token field. The config format is in the mailswitch docs for the generic HTTP provider. Before you save, set the `EMAIL_HTTP_ALLOW_HOSTS` secret to the hosts that the config names, separated by commas. For example, run `npx wrangler secret put EMAIL_HTTP_ALLOW_HOSTS` and enter `api.mail.example`. This provider has no webhooks.

The app records bounces, spam complaints, and unsubscribes. For each one, it adds a row to the document history, shows a notification, and emails the Owner. Resend, toSend, and Amazon SES send no unsubscribe events.

To make a random value, use `openssl rand -base64 32`.

### Fallback provider and daily caps

You can add one fallback provider. The app uses it only when the primary provider does not send an email. The fallback provider has its own webhook URL, which ends in `/api/webhooks/email/fallback`.

Each provider has a daily cap: the most emails that it sends in 24 hours. Set the cap to the limit of your plan. If you leave it empty, the app uses its default for that provider.

### Emails that need review

Sometimes the app cannot tell if the provider sent an email. The document then shows the email under **Emails that need review**. Check with the recipient or in the provider dashboard. Then mark the email as sent, or send it again.

The app does not retry these emails by itself, because a retry can send a second copy. Two related messages can show in the send dialog:

- **This document is being sent now:** another send of the same document is still running. Do not send it again. Reload the page to see the result.
- **An earlier send needs review:** resolve the earlier email under **Emails that need review** first.

## 6. Check Browser Run

The `BROWSER` binding needs no setup on the Free plan. Check it once after the deploy:

1. Create a client with your own email as the contact.
2. Create a quote for that client and send it.
3. Open the quote in the app and select **Download PDF**.
4. Open the PDF and check the layout, fonts, and logo.

The first PDF can take some seconds. If the app shows that the PDF is being prepared, wait 10 seconds and try again.

You can also check the binding before real use with `pnpm build` and then `pnpm wrangler dev --remote`. This runs the built Worker on Cloudflare with the real bindings. It uses the production D1 database and R2 bucket, so do not use it after you have real data.

## 7. Optional: turn on Google sign-in

Google sign-in is optional. Members can always sign in with an email and a password.

Create the Google OAuth client:

1. In the Google Cloud console, open **APIs & Services** > **Credentials**.
2. If Google asks, set up the OAuth consent screen. Add your app name and your email.
3. Select **Create credentials** > **OAuth client ID**.
4. Set the application type to **Web application**.
5. Add this authorized redirect URI: `https://invoices.example.com/api/auth/callback/google`.
6. Create the client. Copy the client ID and the client secret.

Give the values to the Worker:

```sh
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
```

If you used the Deploy button, add the two secrets in the dashboard instead. Open the Worker and go to **Settings** > **Variables and Secrets**.

The sign-in page shows the Google button only when both secrets are set. Google sign-in works only for an email that is a member or has an open invite. Google must have verified the email.

## 8. Add team members

1. In the app, open **Settings** > **Team** and select **Add member**.
2. Enter the email and choose the role, **Owner** or **Member**.
3. Save. The app creates an invite link.
4. If email is set up, the app sends the link to the person. If not, copy the link and send it to the person yourself.

The invite link works one time, for 7 days. The person opens the link and sets a password. They can also sign in with Google, if Google sign-in is on and the Google email is the invited email.

The member menu on the Team page has these actions:

- **Resend invite:** makes a new invite link.
- **Reset sign-in:** ends the member's sessions, removes their password and their Google sign-in, and makes a link that lets them set a new password. The link works for 24 hours.
- **Remove:** removes the member and ends their sessions at once. The app does not let you remove the last Owner.

Members can also reset their own password from the sign-in page, if email is set up. The app sends at most 2 reset emails per hour to one address.

The app shows an invite link or a reset link only one time. If the link is lost, use **Resend invite** or **Reset sign-in** to make a new one.

## 9. Recover a locked-out Owner

Use this procedure only when no Owner can sign in, and a password reset by email is not possible.

1. Make a new random value with `openssl rand -base64 32`. Do not use a value that was used before.
2. Set it as the `SETUP_TOKEN` secret:

   ```sh
   pnpm wrangler secret put SETUP_TOKEN
   ```

   If you used the Deploy button, set the secret in the dashboard instead.

3. Open `https://invoices.example.com/recover`.
4. Enter the setup token, the Owner email, and a new password.
5. Sign in with the new password.
6. Delete the `SETUP_TOKEN` secret again, as in step 4.

Recovery ends all sessions of that Owner. The app sends an email about the recovery to every Owner, if email is set up.

## Upgrade from the Cloudflare Access version

Earlier versions used Cloudflare Access for sign-in and Resend for email. If you run one of these versions, do these steps after you deploy the new version:

1. Set the new secrets: `SETUP_TOKEN`, `AUTH_SECRET`, and `ENCRYPTION_KEY`. `pnpm run ship` makes them for you.
2. Existing users have no password. Setup is closed, because users already exist. Open `/recover` with the setup token, and set a password for an Owner email.
3. Sign in as that Owner. On the Team page, select **Reset sign-in** for each member, and send each member their link.
4. Set up email in **Settings** > **Email**. The old `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` secrets are no longer used. Delete them.
5. In Zero Trust, delete the three Access applications of the app.

## Change a secret

Change a secret only when you must. Some changes have effects on all users:

- **`ENCRYPTION_KEY`:** The app cannot read the saved email provider keys after a change. Enter the provider keys and webhook secrets again in **Settings** > **Email**.
- **`AUTH_SECRET`:** A change signs everyone out. Each member must sign in again.
- **`APP_URL`:** It must be the origin in the address bar. Otherwise the app refuses changes from the browser.

## Free-tier limits

| Service | Free limit | What happens at the limit |
| --- | --- | --- |
| Workers requests | 100,000 per day, reset at 00:00 UTC | Cloudflare shows error 1027 until the reset. |
| Workers CPU time | 10 ms per request | The request fails. The app keeps each request small. A password sign-in fits in this limit. |
| D1 queries | 50 per invocation. One `batch()` call counts as one query. | The request fails. The scheduler counts its D1 queries and claims a job only when the budget can pay for it. A document send uses about 30 queries, so the :15, :30, and :45 ticks each run one send and nothing else. The :00 tick queues new work and runs small jobs. |
| Cron Triggers | 5 per account | The app uses 1 trigger, every 15 minutes. |
| D1 rows read | 5 million per day, reset at 00:00 UTC | Queries fail with an error until the reset. |
| D1 rows written | 100,000 per day, reset at 00:00 UTC | Queries fail with an error until the reset. |
| D1 storage | 500 MB per database, 5 GB per account | Inserts fail. Delete old data or upgrade. |
| Durable Objects | 100,000 requests and 100,000 SQLite rows written per day, reset at 00:00 UTC | The app uses one Durable Object for the sign-in rate limits. Password sign-in still works, but setup and recovery fail until the reset. |
| R2 | 10 GB-month storage, 1 million Class A and 10 million Class B operations per month | Usage above the free amount needs a paid plan. |
| Browser Run | 10 minutes of browser time per day, 1 Quick Action every 10 seconds | The app shows "The PDF is being prepared". Try again later. Cached PDFs still download. |
| Email | Depends on your provider | Set the daily cap of each provider in **Settings** > **Email**. At the cap, manual sends show an error. Scheduled sends wait until the cap resets. |

The expected use is fewer than 100 invoices per month and fewer than 10 users. This is far below each limit.

## Backups

Export the D1 database to a SQL file:

```sh
pnpm wrangler d1 export plainbooks --remote --output=backup-$(date +%F).sql
```

Keep the file in a safe place. It contains client data. D1 Time Travel also keeps 7 days of history on the Free plan.

## Troubleshooting

### The setup screen says that setup is turned off

The `SETUP_TOKEN` secret is missing or has fewer than 32 characters. Set a new value with 32 characters or more, then reload the page.

### The setup screen does not accept the token

- Copy the token again. Do not copy spaces before or after it.
- A token that was used once does not work again. Set a new value.
- After many wrong attempts, the app refuses new attempts for some minutes. Wait and try again.

### Sign-in fails

- Check the email and the password. The password has 12 to 128 characters.
- After many wrong attempts, the app refuses new attempts for up to 15 minutes. Wait and try again. The limit is 5 failed attempts from one network address, and 20 failed attempts for one email. Successful sign-ins do not count.
- If you forgot the password and email is set up, select **Forgot your password?** on the sign-in page.
- Otherwise, ask an Owner to reset your sign-in on the Team page. If no Owner can sign in, follow step 9.

### Google sign-in fails

- "This Google account has no invite": ask an Owner to add your email on the Team page.
- "Your invite was used or has expired": ask an Owner to resend the invite.
- "Google has not verified this email address": use another Google account.
- An error from Google about the redirect URI: check that the OAuth client has the redirect URI `https://invoices.example.com/api/auth/callback/google`. It must use the same host as `APP_URL`.

### You get a 403 error after sign-in

If the error code is `cross_site_request`, the page origin is not the origin of `APP_URL`. Set `APP_URL` to the origin in the address bar. If you used the deploy script, change `APP_HOST` in `.deploy.env` and run `pnpm run ship` again. If you used the Deploy button, change the `APP_URL` secret in the dashboard.

If the error code is `not_a_member`, your user is not an active member. Ask an Owner to add you on the Team page.

### The email webhook fails

- A 401 response with `invalid_signature` means that the webhook secret in **Settings** > **Email** does not match the secret of the webhook at the provider. Enter the secret again.
- A 401 response also comes when the provider for that role is not set up. Check that the URL ends in `primary` for the primary provider and in `fallback` for the fallback provider.
- For Postmark, the webhook Basic auth username must be `mailswitch`.
- For Amazon SES, check that the topic ARN of each subscription is in the **Allowed SNS topic ARNs** field.
- A 401 response also comes when a saved setting does not fit the provider, for example a Postmark secret that is too short or a missing MailChannels customer handle. The log has a line that names the role. Enter the setting again and save.
- A 500 response with a log line about the query limit means that one webhook request had too many events. The Workers Free plan allows 50 database queries per request. At the provider, select only the bounce, complaint, and unsubscribe events, so each request carries fewer events.

### Sign-in fails with error 1102

Error 1102 means that the Worker used more CPU time than the plan allows. The Workers Free plan allows 10 ms per request. A password check is the most expensive step in the app.

1. In `wrangler.jsonc`, add `"PBKDF2_ITERATIONS": "50000"` to `vars`. The default is 100000.
2. Deploy again.
3. Sign in again. The app updates each stored password to the new setting at the next sign-in.

A lower value makes stored passwords faster to guess if someone copies the database. Use the highest value that works on your plan.

### Settings shows that the provider keys need re-entry

The app cannot read the saved keys. This occurs when `ENCRYPTION_KEY` changes or is missing. Check that `ENCRYPTION_KEY` is set. Then enter the provider keys and webhook secrets again.

### The PDF stays "being prepared"

- Only one Quick Action can run every 10 seconds. Wait and try again.
- After 10 minutes of browser time in one day, Browser Run refuses new PDFs until 00:00 UTC. Cached PDFs still download.
- Check the Worker logs in the Cloudflare dashboard for the Browser Run error.

### Emails do not send

1. Open **Settings** > **General** and check that the sender email is set and is on the verified domain.
2. At your email provider, check that the domain is verified.
3. Open **Settings** > **Email** and send a test email. The error message comes from the provider.
4. Check the daily cap. After the cap, the app waits until the cap resets.
5. Open the document activity. A **Send failed** entry shows the error from the provider.

### Error 1027

The Worker used all 100,000 free requests for the day. Requests work again after 00:00 UTC. If this happens often, check for a script or bot that calls the app, or upgrade to the Workers Paid plan.
