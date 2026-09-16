interface Props {
  label: string;
  disabled: boolean;
  disabledReason?: string;
  onInsert: () => void;
}

/**
 * Thin hover target rendered directly above a comic row. Hovering (or
 * focusing, for keyboard users) reveals a line spanning the row with a "+"
 * button at its right edge; clicking it inserts a new section divider
 * immediately above that comic.
 */
export function DividerInsertZone({ label, disabled, disabledReason, onInsert }: Props) {
  return (
    <div className="divider-insert-zone">
      <div className="divider-insert-line" aria-hidden="true" />
      <button
        type="button"
        className="divider-insert-button"
        onClick={onInsert}
        disabled={disabled}
        aria-label={label}
        title={disabled ? disabledReason : 'Insert section divider here'}
      >
        +
      </button>
    </div>
  );
}
