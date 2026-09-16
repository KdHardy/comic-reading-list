# Deployment runbook

Production deployment is intentionally a two-stage process:

1. GitHub merges an explicitly approved pull request into `master` only after CI passes.
2. The existing Cloudflare Workers Builds integration observes the new `master` commit and builds
   and deploys it from the `web` directory.

GitHub Actions does not hold Cloudflare credentials and does not deploy directly.

## Normal pull requests

Every pull request targeting `master` runs the `Web tests and build` check. It installs locked
dependencies, runs the Vitest suite and migration test, and creates the production bundle.
Opening, updating, or approving a pull request never deploys it.

Fork pull requests may run this read-only CI. The checkout does not retain GitHub credentials, and
CI receives no repository secrets or write-capable token.

## Request a deployment

Before requesting a deployment:

1. Make the pull request ready for review.
2. Update its branch with the current `master`; the branch must not be behind.
3. Wait for `Web tests and build` to pass.
4. Post a pull request comment containing exactly:

   ```text
   /deploy
   ```

Only a repository owner, maintainer, or collaborator with write permission can issue the command.
The pull request must come from this repository, not a fork. Requests are serialized so only one
production merge is evaluated at a time.

The gate pins the pull request head commit, verifies the trusted commenter's current repository
permission, requires the named GitHub Actions check to succeed, and verifies the head and base
commits again immediately before merging. Any new commit or intervening `master` change stops the
deployment; update the branch and post `/deploy` again.

Pull requests that change anything under `.github/workflows/` cannot approve themselves and must be
merged manually by a repository administrator. This includes the pull request that first installs
this automation.

## Security model

The deploy gate runs from the workflow already on `master` in response to `issue_comment`. It never
checks out, imports, or executes pull request code. It deliberately does not use
`pull_request_target`, which avoids running untrusted code with a write-capable token.

The CI workflow has only read access to repository contents. The deploy workflow has only the
permissions needed to read checks, validate the pull request, post an audit comment, and merge.
Workflow actions are pinned to immutable commit SHAs.

There is currently no dedicated deployment label, so comments are the deployment signal. Generic
labels such as `enhancement` or `documentation` must never trigger a deployment.

Repository rules should also require `Web tests and build` on `master` when branch protection is
available. The deploy gate enforces that check itself and does not assume protection is configured.

## Verify a deployment

After the merge:

1. Confirm Cloudflare reports a successful Workers Build for the new `master` commit.
2. Open the production Worker URL and smoke-test the affected behavior.
3. If Cloudflare fails, inspect its build log. Fix the failure in a new pull request; do not bypass
   the gate or deploy an unreviewed local tree.

Cloudflare's post-merge build is asynchronous, so the GitHub merge comment confirms handoff to
Cloudflare, not production health.

## Roll back

Use a forward-moving revert so repository history remains the source of truth:

1. Create a branch from the latest `master`.
2. Revert the bad merge commit with `git revert -m 1 <merge-commit>`.
3. Open a pull request, let `Web tests and build` pass, and post `/deploy`.
4. Verify the resulting Cloudflare build and production behavior.

For an urgent outage, an authorized Cloudflare operator may temporarily roll back to a known-good
Worker version in the Cloudflare dashboard. Immediately follow it with the Git revert pull request;
the next successful build from `master` will otherwise replace the dashboard rollback.

Never force-push or reset `master` to roll back production.
