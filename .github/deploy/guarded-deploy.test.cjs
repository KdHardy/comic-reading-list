'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  CURSOR_APP,
  isGenuineCursorAppComment,
  isTrustedDeploySignal,
} = require('./guarded-deploy.cjs');

function genuineCursorComment() {
  return {
    author_association: 'CONTRIBUTOR',
    body: '/deploy',
    user: {
      id: CURSOR_APP.botId,
      login: CURSOR_APP.botLogin,
      node_id: CURSOR_APP.botNodeId,
      type: 'Bot',
    },
    performed_via_github_app: {
      id: CURSOR_APP.appId,
      node_id: CURSOR_APP.appNodeId,
      slug: CURSOR_APP.appSlug,
      owner: {
        id: CURSOR_APP.appOwnerId,
        login: CURSOR_APP.appOwnerLogin,
        node_id: CURSOR_APP.appOwnerNodeId,
      },
    },
  };
}

describe('guarded deploy identity policy', () => {
  it('accepts the genuine Cursor GitHub App event observed on PR #7', () => {
    const comment = genuineCursorComment();

    assert.equal(isGenuineCursorAppComment(comment), true);
    assert.equal(isTrustedDeploySignal(comment), true);
  });

  it('retains trusted human association support', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      assert.equal(
        isTrustedDeploySignal({
          author_association: association,
          body: '/deploy',
          user: { login: 'maintainer', type: 'User' },
        }),
        true
      );
    }
  });

  it('rejects an untrusted human or unrelated bot', () => {
    for (const user of [
      { id: 1, login: 'contributor', node_id: 'U_1', type: 'User' },
      { id: 2, login: 'other[bot]', node_id: 'BOT_2', type: 'Bot' },
    ]) {
      assert.equal(
        isTrustedDeploySignal({
          author_association: 'CONTRIBUTOR',
          body: '/deploy',
          user,
        }),
        false
      );
    }
  });

  it('rejects lookalike Cursor bot events when any immutable identity field differs', () => {
    const mutations = [
      (comment) => { comment.user.login = 'cursor-lookalike[bot]'; },
      (comment) => { comment.user.id += 1; },
      (comment) => { comment.user.node_id = 'BOT_spoof'; },
      (comment) => { comment.user.type = 'User'; },
      (comment) => { comment.performed_via_github_app.id += 1; },
      (comment) => { comment.performed_via_github_app.node_id = 'A_spoof'; },
      (comment) => { comment.performed_via_github_app.slug = 'cursor-lookalike'; },
      (comment) => { comment.performed_via_github_app.owner.id += 1; },
      (comment) => { comment.performed_via_github_app.owner.login = 'cursor-lookalike'; },
      (comment) => { comment.performed_via_github_app.owner.node_id = 'O_spoof'; },
    ];

    for (const mutate of mutations) {
      const comment = genuineCursorComment();
      mutate(comment);
      assert.equal(isGenuineCursorAppComment(comment), false);
      assert.equal(isTrustedDeploySignal(comment), false);
    }
  });

  it('rejects a bot login without performed_via_github_app provenance', () => {
    const comment = genuineCursorComment();
    delete comment.performed_via_github_app;

    assert.equal(isTrustedDeploySignal(comment), false);
  });

  it('requires an exact deploy command from every trusted identity', () => {
    for (const body of ['/Deploy', '/deploy ', 'please /deploy', '/deploy\n']) {
      const comment = genuineCursorComment();
      comment.body = body;
      assert.equal(isTrustedDeploySignal(comment), false);
    }
  });
});

describe('guarded deploy workflow token scopes', () => {
  it('keeps pull-requests write so PR comments and merges succeed', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '../workflows/guarded-deploy.yml'),
      'utf8'
    );
    const permissions = workflow.match(/^permissions:\n((?:  .+\n)+)/m)?.[1] ?? '';

    assert.match(permissions, /^  checks: read$/m);
    assert.match(permissions, /^  contents: write$/m);
    assert.match(permissions, /^  issues: write$/m);
    assert.match(permissions, /^  pull-requests: write$/m);
    assert.doesNotMatch(permissions, /pull-requests:\s*read/);
  });
});
