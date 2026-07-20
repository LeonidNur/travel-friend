'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import {
  createProfileDraft,
  toUserProfile,
  type ProfileDraft
} from '@/lib/current-user-profile-session';
import {
  validateProfile,
  type ProfileValidationErrors
} from '@/lib/profile-validation';
import {
  BUDGET_OPTIONS,
  COMFORT_OPTIONS,
  INTEREST_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  getAvatarInitials,
  getBudgetLabel,
  getComfortLabel,
  toggleMultiValue
} from '@/lib/travel-preferences';
import type { UserProfile } from '@/lib/types';

const TRUST_SIGNALS = [
  { title: 'Telegram connected', note: 'Профиль привязан к Telegram Mini App' },
  { title: 'Verification later', note: 'Подтверждение личности и бейджи появятся в следующих этапах MVP' }
] as const;

type DetailItem = {
  label: string;
  value: string;
};

type TrustSignal = {
  title: string;
  note: string;
};

function createDetailItems(profile: UserProfile): DetailItem[] {
  return [
    { label: 'Желаемые направления', value: profile.destinations.join(', ') },
    { label: 'Бюджет', value: getBudgetLabel(profile.budgetLevel) },
    { label: 'Даты', value: profile.dates },
    { label: 'Стиль отдыха', value: profile.travelStyles.join(', ') },
    { label: 'Уровень комфорта', value: getComfortLabel(profile.comfortLevel) }
  ];
}

function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div className="detail-list__item" key={item.label}>
          <dt className="detail-list__label">{item.label}</dt>
          <dd className="detail-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TrustStack({ items }: { items: readonly TrustSignal[] }) {
  return (
    <div className="trust-stack">
      {items.map((item) => (
        <div className="trust-stack__item" key={item.title}>
          <div className="trust-stack__row">
            <span className="trust-stack__title">{item.title}</span>
            <span className="trust-stack__badge">placeholder</span>
          </div>
          <p className="trust-stack__note">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

function ChipSelector<T extends string>({
  options,
  selectedValues,
  onToggle
}: {
  options: readonly T[];
  selectedValues: readonly T[];
  onToggle: (value: T) => void;
}) {
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

function LevelSelector<TLevel extends number>({
  legend,
  name,
  value,
  options,
  onChange
}: {
  legend: string;
  name: string;
  value: TLevel;
  options: readonly { level: TLevel; label: string; description: string }[];
  onChange: (nextValue: TLevel) => void;
}) {
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

export default function ProfilePage() {
  const { profile, saveProfile } = useCurrentUserProfile();
  const [draftProfile, setDraftProfile] = useState<ProfileDraft>(() => createProfileDraft(profile));
  const [isEditing, setIsEditing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ProfileValidationErrors>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cityInputRef = useRef<HTMLInputElement>(null);

  const detailItems = createDetailItems(profile);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.dataset.profileEditMode = isEditing ? 'true' : 'false';

    return () => {
      delete document.body.dataset.profileEditMode;
    };
  }, [isEditing]);

  const handleEditStart = () => {
    setDraftProfile(createProfileDraft(profile));
    setValidationErrors({});
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraftProfile(createProfileDraft(profile));
    setValidationErrors({});
    setIsEditing(false);
  };

  const handleSave = () => {
    const validationResult = validateProfile(draftProfile);

    if (!validationResult.isValid) {
      setValidationErrors(validationResult.errors);

      if (validationResult.errors.name) {
        nameInputRef.current?.focus();
      } else if (validationResult.errors.city) {
        cityInputRef.current?.focus();
      }

      return;
    }

    const savedProfile = toUserProfile(draftProfile);

    saveProfile(savedProfile);
    setDraftProfile(createProfileDraft(savedProfile));
    setValidationErrors({});
    setIsEditing(false);
  };

  const handleTextChange =
    (field: 'name' | 'city' | 'destinations' | 'dates') => (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setDraftProfile((current) => ({ ...current, [field]: nextValue }));

      if (field === 'name' || field === 'city') {
        setValidationErrors((current) => {
          if (!current[field]) {
            return current;
          }

          return field === 'name'
            ? { city: current.city }
            : { name: current.name };
        });
      }
    };

  const handleAgeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextAge = Number(event.target.value);
    setDraftProfile((current) => ({ ...current, age: nextAge }));
  };

  return (
    <section className="page">
      <article className="hero-card">
        <div className="profile-header">
          <p className="section-kicker">Профиль</p>
          {isEditing ? (
            <span className="profile-status">Editing</span>
          ) : (
            <button type="button" className="profile-action" onClick={handleEditStart}>
              Edit profile
            </button>
          )}
        </div>

        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {getAvatarInitials(profile.name)}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">
              {profile.name}, {profile.age}
            </h2>
            <p className="profile-hero__city">{profile.city}</p>
          </div>
        </div>

        <div className="chip-row" aria-label="Статус профиля">
          <span className="chip chip--accent">Telegram connected</span>
          <span className="chip">Verification later</span>
        </div>
      </article>

      {isEditing ? (
        <article className="surface-card">
          <div className="profile-form">
            <div className="profile-form__section">
              <p className="surface-card__title">Основное</p>
              <label className="profile-form__field">
                <span className="profile-form__label">Имя</span>
                <input
                  ref={nameInputRef}
                  className="profile-input"
                  type="text"
                  value={draftProfile.name}
                  onChange={handleTextChange('name')}
                  placeholder="Как вас зовут"
                  aria-invalid={validationErrors.name ? 'true' : undefined}
                  aria-describedby={validationErrors.name ? 'profile-name-error' : undefined}
                />
                {validationErrors.name ? (
                  <p className="profile-field-error" id="profile-name-error" role="alert">
                    {validationErrors.name}
                  </p>
                ) : null}
              </label>

              <label className="profile-form__field">
                <span className="profile-form__label">Возраст: {draftProfile.age}</span>
                <input
                  className="profile-range"
                  type="range"
                  min={18}
                  max={60}
                  step={1}
                  value={draftProfile.age}
                  onChange={handleAgeChange}
                />
              </label>

              <label className="profile-form__field">
                <span className="profile-form__label">Город</span>
                <input
                  ref={cityInputRef}
                  className="profile-input"
                  type="text"
                  value={draftProfile.city}
                  onChange={handleTextChange('city')}
                  placeholder="Город"
                  aria-invalid={validationErrors.city ? 'true' : undefined}
                  aria-describedby={validationErrors.city ? 'profile-city-error' : undefined}
                />
                {validationErrors.city ? (
                  <p className="profile-field-error" id="profile-city-error" role="alert">
                    {validationErrors.city}
                  </p>
                ) : null}
              </label>
            </div>

            <div className="profile-form__section">
              <p className="surface-card__title">Интересы</p>
              <ChipSelector
                options={INTEREST_OPTIONS}
                selectedValues={draftProfile.interests}
                onToggle={(value) =>
                  setDraftProfile((current) => ({
                    ...current,
                    interests: toggleMultiValue(current.interests, value)
                  }))
                }
              />
            </div>

            <div className="profile-form__section">
              <p className="surface-card__title">Travel preferences</p>

              <label className="profile-form__field">
                <span className="profile-form__label">Направления</span>
                <input
                  className="profile-input"
                  type="text"
                  value={draftProfile.destinations}
                  onChange={handleTextChange('destinations')}
                  placeholder="Например: Стамбул, Тбилиси, Бали"
                />
              </label>

              <label className="profile-form__field">
                <span className="profile-form__label">Даты</span>
                <input
                  className="profile-input"
                  type="text"
                  value={draftProfile.dates}
                  onChange={handleTextChange('dates')}
                  placeholder="Например: август, 7-14 дней"
                />
              </label>

              <LevelSelector
                legend="Бюджет"
                name="budget"
                value={draftProfile.budgetLevel}
                options={BUDGET_OPTIONS}
                onChange={(budgetLevel) =>
                  setDraftProfile((current) => ({
                    ...current,
                    budgetLevel
                  }))
                }
              />

              <div className="profile-form__field">
                <span className="profile-form__label">Стиль отдыха</span>
                <ChipSelector
                  options={TRAVEL_STYLE_OPTIONS}
                  selectedValues={draftProfile.travelStyles}
                  onToggle={(value) =>
                    setDraftProfile((current) => ({
                      ...current,
                      travelStyles: toggleMultiValue(current.travelStyles, value)
                    }))
                  }
                />
              </div>

              <LevelSelector
                legend="Уровень комфорта"
                name="comfort"
                value={draftProfile.comfortLevel}
                options={COMFORT_OPTIONS}
                onChange={(comfortLevel) =>
                  setDraftProfile((current) => ({
                    ...current,
                    comfortLevel
                  }))
                }
              />
            </div>

            <div className="profile-actions">
              <button type="button" className="profile-button profile-button--primary" onClick={handleSave}>
                Save
              </button>
              <button type="button" className="profile-button profile-button--secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        </article>
      ) : null}

      <section className="card-grid" aria-label="Профиль пользователя">
        <article className="surface-card">
          <p className="surface-card__title">Интересы</p>
          <div className="chip-row" aria-label="Интересы путешествий">
            {profile.interests.map((interest) => (
              <span className="chip" key={interest}>
                {interest}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Travel preferences</p>
          <DetailList items={detailItems} />
        </article>

        <article className="surface-card surface-card--wide">
          <p className="surface-card__title">Trust / safety</p>
          <TrustStack items={TRUST_SIGNALS} />
        </article>
      </section>
    </section>
  );
}
