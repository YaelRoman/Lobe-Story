export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  describedBy,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Id of a visible line that explains the choices: read with each button. */
  describedBy?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} data-value={v} aria-pressed={value === v} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
