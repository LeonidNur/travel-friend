'use client';

import { ChangeEvent, FormEvent, useRef, useState } from 'react';

import { ChipSelector, LevelSelector } from '@/components/ProfileSelectors';
import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type ProfileResponse } from '@/lib/backend-api-client';
import {
  createOnboardingProfileDraft,
  saveOnboardingProfile,
  type OnboardingProfileDraft,
  type OnboardingProfileValidationErrors
} from '@/lib/onboarding-profile';
import {
  BUDGET_OPTIONS,
  COMFORT_OPTIONS,
  INTEREST_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  toggleMultiValue
} from '@/lib/travel-preferences';

const backendApiClient = createBackendApiClient();

export function OnboardingProfileScreen() {
  const { onboardingStatus, session, markOnboardingInProgress } = useTelegramAuthSession();
  const { serverProfile, setServerProfile } = useCurrentUserProfile();

  if (serverProfile.status === 'loading') {
    return <OnboardingMessage title="Загружаем профиль" message="Подготавливаем первый шаг настройки." />;
  }

  if (serverProfile.status === 'error') {
    return <OnboardingMessage title="Не удалось загрузить профиль" message="Попробуйте открыть приложение ещё раз." />;
  }

  return (
    <OnboardingProfileForm
      profile={serverProfile.profile}
      onboardingStatus={onboardingStatus}
      token={session?.accessToken ?? null}
      onProfileSaved={setServerProfile}
      onOnboardingStarted={markOnboardingInProgress}
    />
  );
}

function OnboardingProfileForm({
  profile,
  onboardingStatus,
  token,
  onProfileSaved,
  onOnboardingStarted
}: Readonly<{
  profile: ProfileResponse | null;
  onboardingStatus: 'not_started' | 'in_progress' | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onOnboardingStarted: () => void;
}>) {
  const [draft, setDraft] = useState<OnboardingProfileDraft>(() => createOnboardingProfileDraft(profile));
  const [validationErrors, setValidationErrors] = useState<OnboardingProfileValidationErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const displayNameInputRef = useRef<HTMLInputElement>(null);

  const updateDraft = (nextDraft: OnboardingProfileDraft) => {
    setDraft(nextDraft);
    setIsSaved(false);
  };

  const handleTextChange =
    (field: 'displayName' | 'birthDate' | 'city' | 'bio') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateDraft({ ...draft, [field]: event.target.value });
      if (field === 'displayName' || field === 'birthDate') {
        setValidationErrors((errors) => ({ ...errors, [field]: undefined }));
      }
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (token === null || onboardingStatus === null) {
      setApiError('Сессия недоступна. Откройте приложение ещё раз.');
      return;
    }

    setIsSaving(true);
    setApiError(null);
    const result = await saveOnboardingProfile({
      draft,
      onboardingStatus,
      token,
      patchOnboarding: backendApiClient.patchOnboarding,
      patchProfile: backendApiClient.patchProfile
    });
    setIsSaving(false);

    if (result.status === 'validation_error') {
      setValidationErrors(result.errors);
      if (result.errors.displayName) {
        displayNameInputRef.current?.focus();
      }
      return;
    }

    if (result.status === 'api_error') {
      setApiError(result.message);
      return;
    }

    onProfileSaved(result.profile);
    if (onboardingStatus === 'not_started') {
      onOnboardingStarted();
    }
    setDraft(createOnboardingProfileDraft(result.profile));
    setValidationErrors({});
    setIsSaved(true);
  };

  return (
    <main className="auth-gate onboarding-profile" aria-live="polite">
      <section className="surface-card auth-gate__card">
        <p className="section-kicker">Шаг 1 из 2</p>
        <h1 className="auth-gate__title">Расскажите немного о себе</h1>
        <p className="surface-card__copy">Эти данные нужны, чтобы подготовить ваш профиль путешественника.</p>

        <form className="profile-form onboarding-profile__form" onSubmit={handleSubmit} noValidate>
          <div className="profile-form__section">
            <label className="profile-form__field">
              <span className="profile-form__label">Имя *</span>
              <input
                ref={displayNameInputRef}
                className="profile-input"
                type="text"
                value={draft.displayName}
                onChange={handleTextChange('displayName')}
                placeholder="Как вас зовут"
                disabled={isSaving}
                aria-invalid={validationErrors.displayName ? 'true' : undefined}
                aria-describedby={validationErrors.displayName ? 'onboarding-name-error' : undefined}
              />
              {validationErrors.displayName ? <FieldError id="onboarding-name-error" message={validationErrors.displayName} /> : null}
            </label>

            <label className="profile-form__field">
              <span className="profile-form__label">Дата рождения</span>
              <input
                className="profile-input"
                type="date"
                value={draft.birthDate}
                onChange={handleTextChange('birthDate')}
                disabled={isSaving}
                aria-invalid={validationErrors.birthDate ? 'true' : undefined}
                aria-describedby={validationErrors.birthDate ? 'onboarding-birth-date-error' : undefined}
              />
              {validationErrors.birthDate ? <FieldError id="onboarding-birth-date-error" message={validationErrors.birthDate} /> : null}
            </label>

            <label className="profile-form__field">
              <span className="profile-form__label">Город</span>
              <input className="profile-input" type="text" value={draft.city} onChange={handleTextChange('city')} disabled={isSaving} />
            </label>

            <label className="profile-form__field">
              <span className="profile-form__label">О себе</span>
              <textarea className="profile-input onboarding-profile__textarea" value={draft.bio} onChange={handleTextChange('bio')} disabled={isSaving} />
            </label>
          </div>

          <div className="profile-form__section">
            <p className="surface-card__title">Интересы</p>
            <ChipSelector<string>
              options={INTEREST_OPTIONS}
              selectedValues={draft.interests}
              onToggle={(value) => updateDraft({ ...draft, interests: toggleMultiValue(draft.interests, value) })}
            />
          </div>

          <div className="profile-form__section">
            <p className="surface-card__title">Предпочтения в поездках</p>
            <div className="profile-form__field">
              <span className="profile-form__label">Стиль путешествий</span>
              <ChipSelector<string>
                options={TRAVEL_STYLE_OPTIONS}
                selectedValues={draft.travelStyle}
                onToggle={(value) => updateDraft({ ...draft, travelStyle: toggleMultiValue(draft.travelStyle, value) })}
              />
            </div>
            <LevelSelector
              legend="Уровень бюджета"
              name="onboarding-budget"
              value={draft.budgetLevel}
              options={BUDGET_OPTIONS}
              disabled={isSaving}
              onChange={(budgetLevel) => updateDraft({ ...draft, budgetLevel })}
            />
            <LevelSelector
              legend="Уровень комфорта"
              name="onboarding-comfort"
              value={draft.comfortLevel}
              options={COMFORT_OPTIONS}
              disabled={isSaving}
              onChange={(comfortLevel) => updateDraft({ ...draft, comfortLevel })}
            />
          </div>

          {apiError ? <p className="profile-field-error" role="alert">{apiError}</p> : null}
          {isSaved ? <p className="onboarding-profile__saved" role="status">Профиль сохранён. Следующий шаг будет добавлен далее.</p> : null}

          <div className="profile-actions">
            <button type="submit" className="profile-button profile-button--primary" disabled={isSaving}>
              {isSaving ? 'Сохраняем…' : 'Сохранить профиль'}
            </button>
            {isSaved ? <button type="button" className="profile-button profile-button--secondary" disabled>Далее</button> : null}
          </div>
        </form>
      </section>
    </main>
  );
}

function FieldError({ id, message }: Readonly<{ id: string; message: string }>) {
  return <p className="profile-field-error" id={id} role="alert">{message}</p>;
}

function OnboardingMessage({ title, message }: Readonly<{ title: string; message: string }>) {
  return (
    <main className="auth-gate" aria-live="polite">
      <section className="surface-card auth-gate__card">
        <p className="section-kicker">Travel Friend</p>
        <h1 className="auth-gate__title">{title}</h1>
        <p className="surface-card__copy">{message}</p>
      </section>
    </main>
  );
}
