import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DividerInsertZone } from './DividerInsertZone';

describe('DividerInsertZone — hover insertion line with right-edge plus', () => {
  it('renders an accessible "+" button reachable by keyboard even though it is only revealed on hover', () => {
    render(<DividerInsertZone label="Insert section divider above Amazing Spider-Man #1" disabled={false} onInsert={vi.fn()} />);

    const button = screen.getByRole('button', {
      name: 'Insert section divider above Amazing Spider-Man #1',
    });
    expect(button).toHaveTextContent('+');
    expect(button).toHaveClass('divider-insert-button');
    // Not removed from the tab order / accessibility tree just because it's
    // visually hidden until hover/focus — no display:none or aria-hidden.
    expect(button).not.toHaveAttribute('aria-hidden');
    expect(button).not.toBeDisabled();
  });

  it('invokes onInsert when clicked or activated via keyboard', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<DividerInsertZone label="Insert section divider above Batman #1" disabled={false} onInsert={onInsert} />);

    const button = screen.getByRole('button', { name: 'Insert section divider above Batman #1' });
    await user.click(button);
    expect(onInsert).toHaveBeenCalledTimes(1);

    button.focus();
    await user.keyboard('{Enter}');
    expect(onInsert).toHaveBeenCalledTimes(2);
  });

  it('disables the button and swaps the tooltip when insertion is unavailable (hide-read active)', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <DividerInsertZone
        label="Insert section divider above Batman #1"
        disabled
        disabledReason="Show read comics to insert dividers"
        onInsert={onInsert}
      />
    );

    const button = screen.getByRole('button', { name: 'Insert section divider above Batman #1' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Show read comics to insert dividers');

    await user.click(button);
    expect(onInsert).not.toHaveBeenCalled();
  });
});
