# Contributing to PlainBooks

Thank you for your help. This guide tells you how to report a problem, suggest a change, and send a pull request.

## Report a bug

Open an issue on GitHub. Include:

- What you did, step by step.
- What you expected to happen.
- What happened. Add the error text or a screenshot.
- Your browser, and whether you run the app locally or on Cloudflare.

Do not put client data, API keys, passwords, or setup tokens in an issue.

## Report a security problem

Do not open a public issue for a security problem. Use **Report a vulnerability** on the **Security** tab of the repository. This sends a private report to the maintainer.

## Suggest a feature

Open an issue before you write code for a large change. Describe the problem that the feature solves. PlainBooks is for one small agency on the free plans, so a feature must stay inside the free-tier limits in [docs/setup.md](docs/setup.md#free-tier-limits).

## Set up your computer

1. Fork the repository and clone your fork.
2. Follow [Run it on your computer](README.md#run-it-on-your-computer) in the README.
3. Add `FAKE_EXTERNALS=1` to `.dev.vars` if you do not have an email provider key.
4. Open the app and complete the setup screen one time. Use the `SETUP_TOKEN` value from `.dev.vars`.

## Make a change

1. Create a branch from `main`.
2. Keep each pull request to one topic.
3. Add or update tests for the behavior that you change. Worker tests go in `test/`. Web tests go next to the code in `src/`.
4. If you change `src/worker/db/schema.ts`, run `pnpm db:generate` and commit the new migration in `migrations/`. Do not edit a migration that is already on `main`.
5. If you change how the app works or how to set it up, update the README or `docs/setup.md`.

## Run the checks

Run these commands before you open a pull request. They must all pass.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
```

Run `pnpm format` to fix lint and format problems that Biome can fix.

`pnpm e2e` uses its own test secrets and databases. If your `.dev.vars` sets other values for the same keys, the run stops with an error. Read [Testing](README.md#testing) in the README.

## Write commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/). Put the area in parentheses. Write the summary in the imperative and in lower case. For example:

```
fix(reminders): restart steps after a due date change
feat(documents): reset a document's public link
```

Common types are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, and `chore`.

## Open a pull request

1. Push your branch to your fork.
2. Open a pull request against `main`.
3. Say what you changed and why. Link the issue if there is one.
4. Add a screenshot for each UI change. Include a phone width (390 px) if the layout changes.

A maintainer reviews each pull request. You may get requests for changes before the merge.

## Releases

A maintainer publishes each release. Copies of the app learn about a release from its tag. The in-app update check and the update workflow (`.github/workflows/update.yml`) both read the newest release.

1. Set `APP_VERSION` in `src/worker/version.ts` to the new version, for example `0.2.0`. Use [semantic versions](https://semver.org/). Keep `version` in `package.json` at `0.0.0`. The Deploy button sets it to `0.0.0` in each copy, and the same value keeps updates free of conflicts.
2. Commit the change with the message `chore: release v0.2.0`, and push it to `main`.
3. Tag the commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The release workflow (`.github/workflows/release.yml`) checks that the tag matches `src/worker/version.ts`. Then it publishes the release with notes from the merged pull requests. Do not tag a pre-release with this format. The workflows read only `vX.Y.Z` tags.

## Write docs

Use short, plain sentences. Use one term for one thing. Write instructions in the imperative, for example "Run `pnpm dev`".

## License

When you contribute, you agree that your contribution is licensed under the [MIT License](LICENSE).
