# Update Plainbooks

Each new version of Plainbooks is a release on [GitHub](https://github.com/me-shaon/plainbooks/releases). This guide tells how you learn about a new release and how you install it.

## How you learn about a new release

- **In the app.** Once a day, the app asks GitHub for the newest release. When a release is newer than the version that you run, the Owner gets a notification. **Settings** > **General** > **Updates** also shows it. The check sends no workspace data to GitHub. To stop the check, turn off **Check for new versions** in the same section.
- **In your repository.** If you add the update workflow to your copy, it opens a pull request with the newest release once a week. GitHub sends you a notification for the pull request. Read [Add the update workflow](#add-the-update-workflow).
- **On GitHub.** On the [Plainbooks repository](https://github.com/me-shaon/plainbooks), select **Watch** > **Custom** > **Releases**. GitHub then sends you an email for each release.

## Update a copy made by the Deploy button

The Deploy button copies the repository to your account. The copy is not a fork, so GitHub does not show new commits from Plainbooks. The copy also has a single commit, and it has these changes:

- It has no `.github` folder.
- `package.json` has your Worker name and the version `0.0.0`.
- `wrangler.jsonc` has your Worker name, database, and bucket.

The update workflow finds the release that your copy started from. It compares your files with each release. Then it applies the changes of the newer release and keeps your own changes.

### Add the update workflow

Do this one time, after the first deploy. The Deploy button does not copy the `.github` folder, so you add the workflow file yourself.

1. Open [`.github/workflows/update.yml`](https://github.com/me-shaon/plainbooks/blob/main/.github/workflows/update.yml) in the Plainbooks repository. Select **Copy raw file**.
2. In your repository, select **Add file** > **Create new file**.
3. Enter the name `.github/workflows/update.yml`, and paste the contents.
4. Select **Commit changes**. Cloudflare deploys the commit. Nothing in the app changes.
5. Let the workflow open pull requests. Read [Let the workflow open pull requests](#let-the-workflow-open-pull-requests).
6. Go to **Actions** > **Update Plainbooks** and select **Run workflow**. If a newer release exists, the pull request shows after a minute.

The update pull requests never change files in `.github`, because GitHub does not let a workflow change workflow files. When a release changes `update.yml`, the pull request says so. Copy the new file in the same way.

### Merge an update

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
- GitHub Actions cannot open pull requests in your repository.

To update by hand, run these commands in a clone of your repository. Replace `v0.1.0` with the release that your copy runs, and `v0.2.0` with the new release. The issue gives both.

```sh
git remote add upstream https://github.com/me-shaon/plainbooks.git
git fetch upstream tag v0.1.0 tag v0.2.0
git diff v0.1.0 v0.2.0 -- . ':(exclude).github' | git apply -3
```

You need the `git remote add` command only one time.

The last command applies the changes between the two releases to your files. Where you changed the same lines, Git adds conflict markers. Fix each conflict. Keep your own values in `wrangler.jsonc`, for example the database ID and the Worker name. Then commit and push. Cloudflare deploys the push.

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
