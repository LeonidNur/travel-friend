'use client';

import { ChangeEvent, FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChipSelector } from '@/components/ProfileSelectors';
import { OnboardingTravelIntentScreen } from '@/components/OnboardingTravelIntentScreen';
import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type ProfileResponse } from '@/lib/backend-api-client';
import { focusFirstValidationErrorField } from '@/lib/form-validation-focus';
import { OnboardingStatusPanel } from '@/components/OnboardingStatusPanel';
import {
  createOnboardingProfileDraft,
  saveOnboardingProfile,
  type OnboardingProfileDraft,
  type OnboardingProfileValidationErrors
} from '@/lib/onboarding-profile';
import {
  INTEREST_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  toggleMultiValue
} from '@/lib/travel-preferences';
import {
  getNextOnboardingVisualStep,
  getOnboardingStepLabel,
  getPreviousOnboardingVisualStep,
  ONBOARDING_SUCCESS_DELAY_MS,
  type OnboardingVisualStep
} from '@/lib/onboarding-visual-steps';

const backendApiClient = createBackendApiClient();

export function OnboardingProfileScreen() {
  const { onboardingStatus, session, markOnboardingInProgress } = useTelegramAuthSession();
  const { serverProfile, setServerProfile } = useCurrentUserProfile();
  const [step, setStep] = useState<OnboardingVisualStep>('profile');

  if (serverProfile.status === 'loading') {
    return <OnboardingMessage title="Загружаем профиль" message="Подготавливаем первый шаг настройки." />;
  }

  if (serverProfile.status === 'error') {
    return <OnboardingMessage title="Не удалось загрузить профиль" message="Попробуйте открыть приложение ещё раз." />;
  }

  if (step === 'first_trip') {
    return <OnboardingTravelIntentScreen />;
  }

  return (
    <OnboardingProfileForm
      profile={serverProfile.profile}
    step={step}
      onboardingStatus={onboardingStatus}
      token={session?.accessToken ?? null}
      onProfileSaved={setServerProfile}
      onOnboardingStarted={markOnboardingInProgress}
    onBack={() => {
      const previousStep = getPreviousOnboardingVisualStep(step);
      if (previousStep !== null) setStep(previousStep);
    }}
    onContinue={() => {
      const nextStep = getNextOnboardingVisualStep(step);
      if (nextStep !== null) setStep(nextStep);
    }}
    />
  );
}

export function OnboardingProfileForm({
  profile,
  step,
  onboardingStatus,
  token,
  onProfileSaved,
  onOnboardingStarted,
  onBack,
  onContinue
}: Readonly<{
  profile: ProfileResponse | null;
  step: Exclude<OnboardingVisualStep, 'first_trip'>;
  onboardingStatus: 'not_started' | 'in_progress' | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onOnboardingStarted: () => void;
  onBack: () => void;
  onContinue: () => void;
}>) {
  const [draft, setDraft] = useState<OnboardingProfileDraft>(() => createOnboardingProfileDraft(profile));
  const [validationErrors, setValidationErrors] = useState<OnboardingProfileValidationErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const birthDateInputRef = useRef<HTMLInputElement>(null);
  const aboutInputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = aboutInputRef.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 54)}px`;
  }, [draft.bio]);

  useEffect(() => () => {
    if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
  }, []);

  const updateDraft = (nextDraft: OnboardingProfileDraft) => {
    setDraft(nextDraft);
  };

  const handleTextChange =
    (field: 'displayName' | 'birthDate' | 'city' | 'bio') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateDraft({ ...draft, [field]: event.target.value });
      setIsSaved(false);
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
    setIsSaved(false);
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
      focusFirstValidationErrorField(result.errors, ['displayName', 'birthDate'], {
        displayName: displayNameInputRef.current,
        birthDate: birthDateInputRef.current
      });
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
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      onContinue();
    }, ONBOARDING_SUCCESS_DELAY_MS);
  };

  return (
    <main className="auth-gate onboarding-profile" aria-live="polite">
      <section className="onboarding-card auth-gate__card">
        <header className="onboarding-card__header">
          <p className="section-kicker">{getOnboardingStepLabel(step)}</p>
          <h1 className="auth-gate__title">{step === 'profile' ? 'Профиль' : 'Стиль поездки'}</h1>
          <p className="surface-card__copy">
            {step === 'profile'
              ? 'Заполните основную информацию, расскажите о себе и выберите интересы.'
              : 'Выберите один или несколько вариантов — их можно сочетать.'}
          </p>
        </header>
        <form className="profile-form onboarding-profile__form" onSubmit={handleSubmit} noValidate>
          {isSaved ? (
            <OnboardingStatusPanel
              title={step === 'profile' ? 'Профиль сохранён' : 'Стиль поездки сохранён'}
              message={step === 'profile'
                ? 'Через секунду откроется выбор стиля поездки.'
                : 'Через секунду откроется план первой поездки.'}
            />
          ) : null}
          {step === 'profile' ? (
            <>
              <section className="onboarding-section">
                <h2 className="surface-card__title">Основная информация</h2>
                <div className="profile-form__section">
                  <label className="profile-form__field">
                    <span className="profile-form__label">Имя *</span>
                    <input
                      ref={displayNameInputRef}
                      className="profile-input"
                      type="text"
                      value={draft.displayName}
                      onChange={handleTextChange('displayName')}
                      placeholder="Введите имя"
                      disabled={isSaving || isSaved}
                      aria-invalid={validationErrors.displayName ? 'true' : undefined}
                      aria-describedby={validationErrors.displayName ? 'onboarding-name-error' : undefined}
                    />
                    {validationErrors.displayName ? <FieldError id="onboarding-name-error" message={validationErrors.displayName} /> : null}
                  </label>

                  <label className="profile-form__field">
                    <span className="profile-form__label">Дата рождения</span>
                    <input
                      ref={birthDateInputRef}
                      className="profile-input"
                      type="date"
                      value={draft.birthDate}
                      onChange={handleTextChange('birthDate')}
                      disabled={isSaving || isSaved}
                      aria-invalid={validationErrors.birthDate ? 'true' : undefined}
                      aria-describedby={validationErrors.birthDate ? 'onboarding-birth-date-error' : undefined}
                    />
                    {validationErrors.birthDate ? <FieldError id="onboarding-birth-date-error" message={validationErrors.birthDate} /> : null}
                  </label>

                  <label className="profile-form__field">
                    <span className="profile-form__label">Город</span>
                    <input className="profile-input" type="text" value={draft.city} onChange={handleTextChange('city')} disabled={isSaving || isSaved} placeholder="Введите город" />
                  </label>
                </div>
              </section>

              <section className="onboarding-section">
                <h2 className="surface-card__title">О себе</h2>
                <textarea ref={aboutInputRef} className="profile-input onboarding-profile__textarea" aria-label="О себе" value={draft.bio} onChange={handleTextChange('bio')} disabled={isSaving || isSaved} placeholder="Расскажите о себе" rows={3} />
              </section>

              <section className="onboarding-section">
                <h2 className="surface-card__title">Интересы</h2>
                <ChipSelector<string>
                  options={INTEREST_OPTIONS}
                  selectedValues={draft.interests}
                  disabled={isSaving || isSaved}
                  onToggle={(value) => updateDraft({ ...draft, interests: toggleMultiValue(draft.interests, value) })}
                />
              </section>
            </>
          ) : (
            <section className="onboarding-section">
              <h2 className="surface-card__title">Стиль поездки</h2>
              <p className="surface-card__copy">Можно выбрать несколько вариантов.</p>
              <ChipSelector<string>
                options={TRAVEL_STYLE_OPTIONS}
                selectedValues={draft.travelStyle}
                  disabled={isSaving || isSaved}
                onToggle={(value) => updateDraft({ ...draft, travelStyle: toggleMultiValue(draft.travelStyle, value) })}
              />
            </section>
          )}

          {apiError ? <p className="profile-field-error" role="alert">{apiError}</p> : null}

          <div className="profile-actions">
            {step === 'travel_style' ? (
              <button type="button" className="profile-button profile-button--secondary" onClick={onBack} disabled={isSaving || isSaved}>
                Назад
              </button>
            ) : null}
            <button type="submit" className="profile-button profile-button--primary" disabled={isSaving || isSaved}>
              {isSaving ? 'Сохранение…' : isSaved ? 'Сохранено' : 'Сохранить'}
            </button>
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
