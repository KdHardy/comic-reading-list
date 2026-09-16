import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(
  readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
) as Record<string, unknown>;

describe('Cloudflare Worker configuration', () => {
  it('targets the portable static-assets Worker contract', () => {
    expect(config).toMatchObject({
      name: 'comic-reading-list',
      assets: {
        directory: './dist',
        not_found_handling: 'single-page-application',
      },
    });
    expect(config).not.toHaveProperty('account_id');
    expect(config).not.toHaveProperty('routes');
  });
});
