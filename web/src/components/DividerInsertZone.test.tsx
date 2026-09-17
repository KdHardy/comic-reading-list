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

  it('remains usable while hide-read is active (insertion is no longer blocked)', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    // Hide-read used to disable this control; insert must stay enabled so the
    // visible unread comic can be the before-target in the full list.
    render(
      <DividerInsertZone
        label="Insert section divider above Batman #1"
        disabled={false}
        onInsert={onInsert}
      />
    );

    const button = screen.getByRole('button', { name: 'Insert section divider above Batman #1' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', 'Insert section divider here');

    await user.click(button);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('disables the button and swaps the tooltip when insertion is explicitly unavailable', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <DividerInsertZone
        label="Insert section divider above Batman #1"
        disabled
        disabledReason="Insert unavailable"
        onInsert={onInsert}
      />
    );

    const button = screen.getByRole('button', { name: 'Insert section divider above Batman #1' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Insert unavailable');

    await user.click(button);
    expect(onInsert).not.toHaveBeenCalled();
  });
});
