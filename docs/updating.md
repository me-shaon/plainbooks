# Update Plainbooks

Each new version of Plainbooks is a release on [GitHub](https://github.com/me-shaon/plainbooks/releases). This guide tells how you learn about a new release and how you install it.

## How you learn about a new release

- **In the app.** Once a day, the app asks GitHub for the newest release. When a release is newer than the version that you run, the Owner gets a notification. **Settings** > **General** > **Updates** also shows it. The check sends no workspace data to GitHub. To stop the check, turn off **Check for new versions** in the same section.
- **In your repository.** If you used the Deploy to Cloudflare button, your repository has the workflow `.github/workflows/update.yml`. Once a week, it opens a pull request with the newest release. GitHub sends you a notification for the pull request.
- **On GitHub.** On the [Plainbooks repository](https://github.com/me-shaon/plainbooks), select **Watch** > **Custom** > **Releases**. GitHub then sends you an email for each release.

## Update a copy made by the Deploy button

The Deploy button copies the repository to your account. The copy is not a fork, so GitHub does not show new commits from Plainbooks. The update workflow does this work for you.

1. Open the pull request with the title **Update Plainbooks to vX.Y.Z**.
2. Read the release notes. The pull request links to them.
3. Merge the pull request.

Cloudflare then builds the app, applies the new database migrations, and deploys it. The merge keeps the changes that Cloudflare and you made to your copy, for example the database ID in `wrangler.jsonc`.

To check for a release now, go to **Actions** > **Update Plainbooks** in your repository and select **Run workflow**.

### Let the workflow open pull requests

A new repository does not let GitHub Actions open pull requests. When the workflow cannot open one, it opens an issue with the manual steps. To let it open pull requests:

1. In your repository, go to **Settings** > **Actions** > **General**.
2. Under **Workflow permissions**, select **Allow GitHub Actions to create and approve pull requests**.
3. Select **Save**.
4. Go to **Actions** > **Update Plainbooks** and select **Run workflow**.

### When the workflow does not run

GitHub turns off scheduled workflows in a repository with no activity for 60 days. GitHub sends you an email before it does this. To turn the workflow on again, go to **Actions** > **Update Plainbooks** and select **Enable workflow**.

The in-app notification does not depend on GitHub Actions. It continues to tell you about new releases.

### Update by hand

The workflow opens an issue instead of a pull request in these cases:

- The update changes lines that you also changed in your copy.
- The update changes a workflow file. GitHub does not let a workflow push that change.
- Git cannot find the release that your copy started from.

To update by hand, run these commands in a clone of your repository. Replace `v0.2.0` with the new release.

```sh
git remote add upstream https://github.com/me-shaon/plainbooks.git
git fetch upstream tag v0.2.0
git merge v0.2.0
```

You need the `git remote add` command only one time.

If Git says `refusing to merge unrelated histories`, run `git merge --allow-unrelated-histories v0.2.0`. Fix the conflicts. Keep your own values in `wrangler.jsonc`, for example the database ID and the Worker name. Then commit and push. Cloudflare deploys the push.

## Update a deploy made by the script

If you deployed with `pnpm run ship`, pull the new release and deploy again:

```sh
git pull
pnpm install
pnpm run ship
```

The script applies the new database migrations before it deploys.

## Back up before an update

Some releases change the database. Before you merge an update, export a backup:

```sh
pnpm wrangler d1 export plainbooks --remote --output=backup-$(date +%F).sql
```

D1 Time Travel also keeps 7 days of history. Read [Backups](setup.md#backups).
