export function ChipSelector<T extends string>({
  options,
  selectedValues,
  onToggle
}: Readonly<{
  options: readonly T[];
  selectedValues: readonly T[];
  onToggle: (value: T) => void;
}>) {
  return (
    <div className="chip-selector" role="group">
      {options.map((option) => {
        const isSelected = selectedValues.includes(option);

        return (
          <button
            type="button"
            className={`chip chip-button${isSelected ? ' chip-button--selected' : ''}`}
            key={option}
            aria-pressed={isSelected}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function LevelSelector<TLevel extends number>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled = false
}: Readonly<{
  legend: string;
  name: string;
  value: TLevel | null;
  options: readonly { level: TLevel; label: string; description: string }[];
  onChange: (nextValue: TLevel) => void;
  disabled?: boolean;
}>) {
  return (
    <fieldset className="profile-form__fieldset">
      <legend className="profile-form__label">{legend}</legend>
      <div className="level-grid">
        {options.map((option) => {
          const checked = option.level === value;

          return (
            <label className={`level-card${checked ? ' level-card--selected' : ''}`} key={option.level}>
              <input
                className="sr-only"
                type="radio"
                name={name}
                value={option.level}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.level)}
              />
              <span className="level-card__label">{option.label}</span>
              <span className="level-card__description">{option.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
