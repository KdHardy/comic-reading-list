'use strict';

const CURSOR_APP = Object.freeze({
  appId: 1210556,
  appNodeId: 'A_kwHOB44z8s4AEni8',
  appOwnerId: 126759922,
  appOwnerLogin: 'cursor',
  appOwnerNodeId: 'O_kgDOB44z8g',
  appSlug: 'cursor',
  botId: 206951365,
  botLogin: 'cursor[bot]',
  botNodeId: 'BOT_kgDODFXTxQ',
});

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const WRITE_PERMISSIONS = new Set(['admin', 'maintain', 'write']);

function isGenuineCursorAppComment(comment) {
  const app = comment?.performed_via_github_app;
  const user = comment?.user;

  return (
    user?.login === CURSOR_APP.botLogin
    && user?.id === CURSOR_APP.botId
    && user?.node_id === CURSOR_APP.botNodeId
    && user?.type === 'Bot'
    && app?.id === CURSOR_APP.appId
    && app?.node_id === CURSOR_APP.appNodeId
    && app?.slug === CURSOR_APP.appSlug
    && app?.owner?.id === CURSOR_APP.appOwnerId
    && app?.owner?.login === CURSOR_APP.appOwnerLogin
    && app?.owner?.node_id === CURSOR_APP.appOwnerNodeId
  );
}

function isTrustedDeploySignal(comment) {
  return (
    comment?.body === '/deploy'
    && (
      TRUSTED_ASSOCIATIONS.has(comment.author_association)
      || isGenuineCursorAppComment(comment)
    )
  );
}

async function run({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const pullNumber = context.issue.number;
  const signal = context.payload.comment;
  const requester = signal.user.login;
  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function comment(body) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
  }

  try {
    if (!isTrustedDeploySignal(signal)) {
      throw new Error('The deploy signal did not come from an authorized identity.');
    }

    const requestedByCursor = isGenuineCursorAppComment(signal);
    if (!requestedByCursor) {
      const permission = await github.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: requester,
      });
      if (!WRITE_PERMISSIONS.has(permission.data.permission)) {
        throw new Error(
          `@${requester} has ${permission.data.permission} permission; write permission is required.`
        );
      }
    }

    let pull = (await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    })).data;

    if (pull.state !== 'open' || pull.draft) {
      throw new Error('The pull request must be open and ready for review.');
    }
    if (pull.base.ref !== 'master') {
      throw new Error('Only pull requests targeting master can deploy.');
    }
    if (pull.head.repo?.full_name !== `${owner}/${repo}`) {
      throw new Error('Fork pull requests cannot use guarded deployment.');
    }
    if (!pull.head.ref.startsWith('cursor/')) {
      throw new Error('Guarded deployment only accepts cursor/* branches.');
    }

    const changedFiles = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    if (
      changedFiles.some(
        (file) =>
          file.filename.startsWith('.github/workflows/')
          || file.filename.startsWith('.github/deploy/')
      )
    ) {
      throw new Error(
        'Deployment-security changes require a manual merge so they cannot approve their own gate.'
      );
    }

    const expectedHead = pull.head.sha;
    const expectedBase = pull.base.sha;
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${expectedBase}...${expectedHead}`,
    });
    if (comparison.data.behind_by !== 0) {
      throw new Error('The pull request branch is behind master. Update it and run /deploy again.');
    }

    await comment(
      `Deployment requested by @${requester}. Waiting for **Web tests and build** on \`${expectedHead.slice(0, 7)}\`.`
    );

    let requiredCheck;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const checks = await github.rest.checks.listForRef({
        owner,
        repo,
        ref: expectedHead,
        check_name: 'Web tests and build',
        filter: 'latest',
        per_page: 100,
      });
      requiredCheck = checks.data.check_runs.find(
        (check) =>
          check.name === 'Web tests and build'
          && check.app?.slug === 'github-actions'
      );

      if (requiredCheck?.status === 'completed') {
        break;
      }
      await sleep(10_000);
    }

    if (!requiredCheck) {
      throw new Error('The required Web tests and build check did not start.');
    }
    if (requiredCheck.status !== 'completed') {
      throw new Error('Timed out waiting for Web tests and build.');
    }
    if (requiredCheck.conclusion !== 'success') {
      throw new Error(
        `Web tests and build concluded with ${requiredCheck.conclusion}; rerun CI and then run /deploy again.`
      );
    }

    pull = (await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    })).data;
    if (
      pull.state !== 'open'
      || pull.draft
      || pull.head.sha !== expectedHead
      || pull.head.ref.startsWith('cursor/') === false
    ) {
      throw new Error('The pull request changed while validation ran. Run /deploy again.');
    }
    if (pull.head.repo?.full_name !== `${owner}/${repo}`) {
      throw new Error('The pull request source changed. Fork pull requests cannot deploy.');
    }
    if (pull.base.ref !== 'master' || pull.base.sha !== expectedBase) {
      throw new Error('Master changed while validation ran. Update the branch and run /deploy again.');
    }
    if (pull.mergeable !== true) {
      throw new Error('GitHub reports that the pull request is not currently mergeable.');
    }

    const merge = await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      sha: expectedHead,
      merge_method: 'merge',
    });
    if (!merge.data.merged) {
      throw new Error(merge.data.message || 'GitHub declined the merge.');
    }

    await comment(
      `Merged \`${expectedHead.slice(0, 7)}\` after required CI passed. Cloudflare Workers Builds will deploy the new master revision.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await comment(`Deployment stopped: ${message}`);
    } finally {
      core.setFailed(message);
    }
  }
}

module.exports = {
  CURSOR_APP,
  isGenuineCursorAppComment,
  isTrustedDeploySignal,
  run,
};
