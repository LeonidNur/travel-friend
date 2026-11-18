import Image from 'next/image';

export function ChipSelector<T extends string>({
  options,
  selectedValues,
  onToggle,
  disabled = false
}: Readonly<{
  options: readonly T[];
  selectedValues: readonly T[];
  onToggle: (value: T) => void;
  disabled?: boolean;
}>) {
  return (
    <div className="chip-selector" role="group">
      {options.map((option) => {
        const isSelected = selectedValues.includes(option);

        return (
          <button
            type="button"
            className="selectable-chip"
            key={option}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onToggle(option)}
          >
            <span className={`chip chip-button${isSelected ? ' chip-button--selected' : ''}`}>{option}</span>
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
  disabled = false,
  iconSrc,
  rangeLabels,
  compactScale = false
}: Readonly<{
  legend: string;
  name: string;
  value: TLevel | null;
  options: readonly { level: TLevel; label: string; description: string }[];
  onChange: (nextValue: TLevel) => void;
  disabled?: boolean;
  iconSrc?: string;
  rangeLabels?: readonly [string, string];
  compactScale?: boolean;
}>) {
  return (
    <fieldset className="profile-form__fieldset" data-icon-selector={iconSrc ? 'true' : undefined} data-compact-scale={compactScale || undefined}>
      <legend className={compactScale ? "sr-only" : "profile-form__label"}>{legend}</legend>
      <div className="level-grid">
        {options.map((option) => {
          const checked = option.level === value;

          return (
            <label className={`level-card${checked ? ' level-card--selected' : ''}`} key={option.level} data-filled={compactScale ? value === null || option.level <= value : undefined}>
              <input
                className="sr-only"
                type="radio"
                name={name}
                value={option.level}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.level)}
              />
              {iconSrc ? <Image className="level-card__icon" src={iconSrc} width={24} height={24} alt="" aria-hidden="true" /> : null}
              <span className={iconSrc ? 'sr-only' : 'level-card__label'}>
                {iconSrc ? `${option.label}: ${option.description}` : option.label}
              </span>
              {iconSrc ? null : <span className="level-card__description">{option.description}</span>}
            </label>
          );
        })}
      </div>
      {iconSrc && rangeLabels ? (
        <div className="level-scale" aria-hidden="true">
          <span className="level-scale__item">
            <Image className="level-scale__icon" src={iconSrc} width={24} height={24} alt="" />
            {rangeLabels[0]}
          </span>
          <span className="level-scale__item">
            <span className="level-scale__icons">
              {options.map((option) => <Image className="level-scale__icon" src={iconSrc} width={24} height={24} alt="" key={option.level} />)}
            </span>
            {rangeLabels[1]}
          </span>
        </div>
      ) : null}
    </fieldset>
  );
}
