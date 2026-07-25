interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function HideReadToggle({ checked, onChange }: Props) {
  return (
    <label className="hide-read-toggle">
      <span className="hide-read-toggle-label">Hide read</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Hide read comics"
      />
    </label>
  );
}
