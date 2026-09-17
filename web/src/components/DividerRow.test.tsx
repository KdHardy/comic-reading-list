import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DividerListEntry } from '../lib/types';
import { DividerRow } from './DividerRow';

function makeEntry(overrides: Partial<DividerListEntry> = {}): DividerListEntry {
  return {
    entry_id: 42,
    list_id: 1,
    entry_type: 'divider',
    book_id: null,
    divider_name: 'Marvel + Jun 02, 2021',
    read_order: 30,
    book: null,
    ...overrides,
  };
}

function renderDivider(overrides: Partial<DividerListEntry> = {}, props: Partial<Parameters<typeof DividerRow>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn();
  const { container } = render(
    <DividerRow
      entry={makeEntry(overrides)}
      orderingDisabled={false}
      onSave={onSave}
      onDelete={onDelete}
      {...props}
    />
  );
  return { onSave, onDelete, container };
}

describe('DividerRow — title-style inline edit controls', () => {
  it('shows the divider name with an accessible edit (pencil) control, matching EditableTitle', () => {
    renderDivider();
    expect(screen.getByText('Marvel + Jun 02, 2021')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' })).toBeInTheDocument();
  });

  it('entering edit mode reveals a name field with complete (save) and clear (cancel) controls', async () => {
    const user = userEvent.setup();
    renderDivider();

    await user.click(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' }));

    expect(screen.getByRole('textbox', { name: 'Divider name' })).toHaveValue('Marvel + Jun 02, 2021');
    expect(screen.getByRole('button', { name: 'Save divider name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel divider edit' })).toBeInTheDocument();
  });

  it('completing the edit persists the trimmed name', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDivider();

    await user.click(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' }));
    const input = screen.getByRole('textbox', { name: 'Divider name' });
    await user.clear(input);
    await user.type(input, '  Act Two  ');
    await user.click(screen.getByRole('button', { name: 'Save divider name' }));

    expect(onSave).toHaveBeenCalledWith(42, 'Act Two');
  });

  it('clearing (cancelling) the edit restores the persisted name without saving', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDivider();

    await user.click(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' }));
    const input = screen.getByRole('textbox', { name: 'Divider name' });
    await user.type(input, 'Extra text');
    await user.click(screen.getByRole('button', { name: 'Cancel divider edit' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Divider name' })).not.toBeInTheDocument();
    expect(screen.getByText('Marvel + Jun 02, 2021')).toBeInTheDocument();
  });

  it('rejects a blank name and never calls onSave', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDivider();

    await user.click(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' }));
    const input = screen.getByRole('textbox', { name: 'Divider name' });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save divider name' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Divider name cannot be blank.')).toBeInTheDocument();
  });

  it('pressing Escape while editing clears the edit like the cancel button', async () => {
    const user = userEvent.setup();
    renderDivider();

    await user.click(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' }));
    const input = screen.getByRole('textbox', { name: 'Divider name' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Divider name' })).not.toBeInTheDocument();
  });
});

describe('DividerRow — slim one-line controls without touch arrows', () => {
  it('does not render the left-edge up/down touch arrows', () => {
    renderDivider();

    expect(screen.queryByRole('button', { name: 'Move divider up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move divider down' })).not.toBeInTheDocument();
    expect(document.querySelector('.book-nav-buttons')).not.toBeInTheDocument();
  });

  it('keeps name/edit, drag, and delete controls on the slim divider row', () => {
    const { container } = renderDivider();

    expect(container.querySelector('.section-divider')).toBeInTheDocument();
    expect(container.querySelectorAll('.section-divider-line')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit divider Marvel + Jun 02, 2021' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toHaveClass('drag-handle');
    expect(screen.getByRole('button', { name: 'Remove divider "Marvel + Jun 02, 2021" from list' })).toHaveClass(
      'book-delete-button'
    );
  });

  it('disables the drag handle while ordering is disabled', () => {
    renderDivider({}, { orderingDisabled: true });

    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toBeDisabled();
  });

  it('calls onDelete with the entry id and current name when the delete button is clicked', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDivider();

    await user.click(screen.getByRole('button', { name: 'Remove divider "Marvel + Jun 02, 2021" from list' }));

    expect(onDelete).toHaveBeenCalledWith(42, 'Marvel + Jun 02, 2021');
  });
});
