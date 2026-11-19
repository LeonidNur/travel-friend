'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';

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
  onContinue,
  previewState
}: Readonly<{
  profile: ProfileResponse | null;
  step: Exclude<OnboardingVisualStep, 'first_trip'>;
  onboardingStatus: 'not_started' | 'in_progress' | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onOnboardingStarted: () => void;
  onBack: () => void;
  onContinue: () => void;
  previewState?: 'validation' | 'saving' | 'saved' | 'error';
}>) {
  const [draft, setDraft] = useState<OnboardingProfileDraft>(() => createOnboardingProfileDraft(profile));
  const [validationErrors, setValidationErrors] = useState<OnboardingProfileValidationErrors>(previewState === 'validation' && step === 'profile' ? { displayName: 'Укажите имя' } : {});
  const [apiError, setApiError] = useState<string | null>(previewState === 'error' ? 'Проверьте подключение и повторите попытку.' : null);
  const [styleError, setStyleError] = useState(previewState === 'validation' && step === 'travel_style');
  const [isSaving, setIsSaving] = useState(previewState === 'saving');
  const [isSaved, setIsSaved] = useState(previewState === 'saved');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const birthDateInputRef = useRef<HTMLInputElement>(null);

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

    if (step === 'travel_style' && draft.travelStyle.length === 0) {
      setStyleError(true);
      setApiError(null);
      return;
    }

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
      setIsSaved(false);
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
            ><button type="button" className="profile-button profile-button--primary" disabled>Сохранено</button></OnboardingStatusPanel>
          ) : null}
          {apiError ? <OnboardingStatusPanel tone="error"
            title={step === 'profile' ? 'Не удалось сохранить профиль' : 'Не удалось сохранить стиль поездки'} message={apiError} /> : null}
          {styleError ?
            <OnboardingStatusPanel tone="error" title="Выберите стиль поездки" message="Нужен хотя бы один вариант, чтобы продолжить." /> : null}
          {step === 'profile' ? (
            <>
              <section className="onboarding-section">
                <h2 className="surface-card__title">Основная информация</h2>
                <div className="profile-form__section">
                  <div className="onboarding-field">
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
                    </label>
                    {validationErrors.displayName ? <FieldError id="onboarding-name-error" message={validationErrors.displayName} /> : null}
                  </div>

                  <div className="onboarding-field">
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
                    </label>
                    {validationErrors.birthDate ? <FieldError id="onboarding-birth-date-error" message={validationErrors.birthDate} /> : null}
                  </div>

                  <label className="profile-form__field">
                    <span className="profile-form__label">Город</span>
                    <input className="profile-input" type="text" value={draft.city} onChange={handleTextChange('city')} disabled={isSaving || isSaved} placeholder="Введите город" />
                  </label>
                </div>
              </section>

              <section className="onboarding-section">
                <h2 className="surface-card__title">О себе</h2>
                <textarea className="profile-input onboarding-profile__textarea" aria-label="О себе" value={draft.bio} onChange={handleTextChange('bio')} disabled={isSaving || isSaved} placeholder="Расскажите о себе" rows={3} />
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
                onToggle={(value) => {
                  setStyleError(false);
                  updateDraft({ ...draft, travelStyle: toggleMultiValue(draft.travelStyle, value) });
                }}
              />
            </section>
          )}

          {!isSaved ? <div className="profile-actions">
            <button type="submit" className="profile-button profile-button--primary" disabled={isSaving}>
              {isSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
            {step === 'travel_style' ? <button type="button" className="onboarding-card__back" onClick={onBack} disabled={isSaving}>Назад</button> : null}
          </div> : null}
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
