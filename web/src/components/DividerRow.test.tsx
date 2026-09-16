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
  const onMove = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn();
  render(
    <DividerRow
      entry={makeEntry(overrides)}
      isFirst={false}
      isLast={false}
      orderingDisabled={false}
      onMove={onMove}
      onSave={onSave}
      onDelete={onDelete}
      {...props}
    />
  );
  return { onMove, onSave, onDelete };
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

describe('DividerRow — drag and delete controls match the book row pattern', () => {
  it('exposes a drag handle using the shared drag-handle icon/class and delete button using the shared icon/class', () => {
    renderDivider();

    const dragHandle = screen.getByRole('button', { name: 'Drag to reorder' });
    expect(dragHandle).toHaveClass('drag-handle');
    expect(dragHandle).toHaveTextContent('☰');

    const deleteButton = screen.getByRole('button', { name: 'Remove divider "Marvel + Jun 02, 2021" from list' });
    expect(deleteButton).toHaveClass('book-delete-button');
    expect(deleteButton).toHaveTextContent('🗑');
  });

  it('disables the drag handle and move buttons while ordering is disabled', () => {
    renderDivider({}, { orderingDisabled: true });

    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move divider up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move divider down' })).toBeDisabled();
  });

  it('calls onDelete with the entry id and current name when the delete button is clicked', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDivider();

    await user.click(screen.getByRole('button', { name: 'Remove divider "Marvel + Jun 02, 2021" from list' }));

    expect(onDelete).toHaveBeenCalledWith(42, 'Marvel + Jun 02, 2021');
  });

  it('calls onMove with the correct direction, and respects isFirst/isLast boundaries', async () => {
    const user = userEvent.setup();
    const { onMove } = renderDivider({}, { isFirst: true, isLast: false });

    expect(screen.getByRole('button', { name: 'Move divider up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move divider down' }));

    expect(onMove).toHaveBeenCalledWith(42, 'down');
  });
});
