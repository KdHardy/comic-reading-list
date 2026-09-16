import { describe, expect, it } from 'vitest';
import { defaultDividerName } from './divider';

describe('defaultDividerName', () => {
  it('joins publisher and formatted publish date with a plus sign', () => {
    expect(defaultDividerName({ publisher: 'Marvel', publish_date: '2021-06-02' })).toBe(
      'Marvel + Jun 02, 2021'
    );
  });

  it('falls back to the publisher alone when there is no publish date', () => {
    expect(defaultDividerName({ publisher: 'DC', publish_date: null })).toBe('DC');
  });

  it('falls back to the formatted date alone when there is no publisher', () => {
    expect(defaultDividerName({ publisher: null, publish_date: '2021-06-02' })).toBe('Jun 02, 2021');
  });

  it('falls back to a generic name when neither publisher nor date is known', () => {
    expect(defaultDividerName({ publisher: null, publish_date: null })).toBe('New Section');
  });

  it('treats a blank/whitespace-only publisher as missing', () => {
    expect(defaultDividerName({ publisher: '   ', publish_date: '2021-06-02' })).toBe('Jun 02, 2021');
  });

  it('never changes once assigned, even if the same comic is later marked completed or moved', () => {
    // The helper only ever computes the name at insertion time; the caller
    // persists the returned string as plain divider_name text, so later
    // book/order changes have no way to feed back into it.
    const name = defaultDividerName({ publisher: 'Image', publish_date: '2019-01-09' });
    expect(name).toBe('Image + Jan 09, 2019');
    expect(defaultDividerName({ publisher: 'Image', publish_date: '2019-01-09' })).toBe(name);
  });
});
