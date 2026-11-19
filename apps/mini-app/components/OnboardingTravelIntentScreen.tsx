'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { OnboardingStatusPanel } from '@/components/OnboardingStatusPanel';
import { LevelSelector } from '@/components/ProfileSelectors';
import {
  createBackendApiClient,
  type OnboardingStatus,
  type ProfileResponse,
  type TravelIntentResponse
} from '@/lib/backend-api-client';
import { focusFirstValidationErrorField } from '@/lib/form-validation-focus';
import { createOnboardingProfileDraft, saveOnboardingProfile } from '@/lib/onboarding-profile';
import {
  createOnboardingTravelIntentDraft,
  saveOnboardingTravelIntent,
  validateOnboardingTravelIntent,
  type OnboardingTravelIntentDraft,
  type OnboardingTravelIntentValidationErrors
} from '@/lib/onboarding-travel-intent';
import { completeOnboarding } from '@/lib/onboarding-completion';
import { ONBOARDING_SUCCESS_DELAY_MS } from '@/lib/onboarding-visual-steps';
import { BUDGET_OPTIONS, COMFORT_OPTIONS } from '@/lib/travel-preferences';

const backendApiClient = createBackendApiClient();

export function OnboardingTravelIntentScreen() {
  const { onboardingStatus, session, markOnboardingCompleted } = useTelegramAuthSession();
  const { serverProfile, setServerProfile, serverTravelIntent, setServerTravelIntent } = useCurrentUserProfile();

  if (serverProfile.status === 'loading') {
    return <TravelIntentMessage title="Загружаем профиль" message="Подготавливаем настройки поездки." />;
  }

  if (serverProfile.status === 'error' || serverProfile.profile === null) {
    return <TravelIntentMessage title="Не удалось загрузить профиль" message="Вернитесь к первому шагу и попробуйте ещё раз." />;
  }

  if (serverTravelIntent.status === 'loading') {
    return <TravelIntentMessage title="Загружаем план поездки" message="Проверяем сохранённые данные." />;
  }

  if (serverTravelIntent.status === 'error' || serverTravelIntent.status === 'invariant_error') {
    return <TravelIntentMessage title="Не удалось загрузить план поездки" message="Попробуйте открыть приложение ещё раз." />;
  }

  return (
    <OnboardingTravelIntentForm
      travelIntent={serverTravelIntent.travelIntent}
      profile={serverProfile.profile}
      onboardingStatus={onboardingStatus}
      token={session?.accessToken ?? null}
      onProfileSaved={setServerProfile}
      onTravelIntentSaved={setServerTravelIntent}
      onOnboardingCompleted={markOnboardingCompleted}
    />
  );
}

export function OnboardingTravelIntentForm({
  travelIntent,
  profile,
  onboardingStatus,
  token,
  onProfileSaved,
  onTravelIntentSaved,
  onOnboardingCompleted,
  previewState
}: Readonly<{
  travelIntent: TravelIntentResponse | null;
  profile: ProfileResponse;
  onboardingStatus: OnboardingStatus | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onTravelIntentSaved: (travelIntent: TravelIntentResponse) => void;
  onOnboardingCompleted: () => void;
  previewState?: 'validation' | 'saving' | 'saved' | 'error' | 'completing' | 'completion-error';
}>) {
  const [draft, setDraft] = useState<OnboardingTravelIntentDraft>(() => createOnboardingTravelIntentDraft(travelIntent));
  const [budgetLevel, setBudgetLevel] = useState(() => createOnboardingProfileDraft(profile).budgetLevel);
  const [comfortLevel, setComfortLevel] = useState(() => createOnboardingProfileDraft(profile).comfortLevel);
  const [validationErrors, setValidationErrors] = useState<OnboardingTravelIntentValidationErrors>(() => (
    previewState === 'validation' ? validateOnboardingTravelIntent(createOnboardingTravelIntentDraft(travelIntent)).errors : {}
  ));
  const [apiError, setApiError] = useState<string | null>(previewState === 'error' ? 'Проверьте подключение и повторите попытку.' : null);
  const [isSaving, setIsSaving] = useState(previewState === 'saving');
  const [isSaved, setIsSaved] = useState(previewState === 'saved');
  const [isCompleting, setIsCompleting] = useState(previewState === 'completing');
  const [isTripDataSaved, setIsTripDataSaved] = useState(previewState === 'completion-error');
  const [completionError, setCompletionError] = useState<string | null>(previewState === 'completion-error' ? 'Повторите завершение настройки.' : null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTravelIntentRef = useRef<TravelIntentResponse | null>(null);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const dateFromInputRef = useRef<HTMLInputElement>(null);
  const dateToInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
  }, []);

  const handleTextChange =
    (field: 'destination' | 'dateFrom' | 'dateTo') => (event: ChangeEvent<HTMLInputElement>) => {
      setDraft({ ...draft, [field]: event.target.value });
      setIsSaved(false);
      setIsTripDataSaved(false);
      savedTravelIntentRef.current = null;
      setCompletionError(null);
      setValidationErrors((errors) => ({
        ...errors,
        [field]: undefined,
        ...(field === 'dateFrom' ? { dateTo: undefined } : {})
      }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (token === null || onboardingStatus === null || onboardingStatus === 'completed') {
      setApiError('Сессия недоступна. Откройте приложение ещё раз.');
      return;
    }

    setApiError(null);
    setCompletionError(null);
    setIsSaved(false);

    if (!isTripDataSaved) {
      setIsSaving(true);
      const profileResult = await saveOnboardingProfile({
        draft: { ...createOnboardingProfileDraft(profile), budgetLevel, comfortLevel },
        onboardingStatus,
        token,
        patchOnboarding: backendApiClient.patchOnboarding,
        patchProfile: backendApiClient.patchProfile
      });

      if (profileResult.status !== 'saved') {
        setIsSaving(false);
        setApiError(profileResult.status === 'api_error'
          ? profileResult.message
          : 'Вернитесь к шагу профиля и заполните обязательные поля.');
        return;
      }

      onProfileSaved(profileResult.profile);
      const result = await saveOnboardingTravelIntent({
        draft,
        token,
        putTravelIntent: backendApiClient.putTravelIntent
      });
      setIsSaving(false);

      if (result.status === 'validation_error') {
        setValidationErrors(result.errors);
        focusFirstValidationErrorField(result.errors, ['destination', 'dateFrom', 'dateTo'], {
          destination: destinationInputRef.current,
          dateFrom: dateFromInputRef.current,
          dateTo: dateToInputRef.current
        });
        return;
      }

      if (result.status === 'api_error') {
        setApiError(result.message);
        return;
      }

      onTravelIntentSaved(result.travelIntent);
      savedTravelIntentRef.current = result.travelIntent;
      setValidationErrors({});
      setIsTripDataSaved(true);
    }

    setIsCompleting(true);
    const result = await completeOnboarding({
      token,
      patchOnboarding: backendApiClient.patchOnboarding,
      applyCompletedState: () => {
        if (savedTravelIntentRef.current !== null) {
          setDraft(createOnboardingTravelIntentDraft(savedTravelIntentRef.current));
        }
        setIsCompleting(false);
        setIsSaved(true);
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          onOnboardingCompleted();
        }, ONBOARDING_SUCCESS_DELAY_MS);
      }
    });

    if (result.status === 'api_error') {
      setIsCompleting(false);
      setCompletionError(result.message);
    }
  };

  return (
    <main className="auth-gate onboarding-profile" aria-live="polite">
      <section className="onboarding-card auth-gate__card">
        <header className="onboarding-card__header">
          <p className="section-kicker">Шаг 3 из 3</p>
          <h1 className="auth-gate__title">Первая поездка</h1>
          <p className="surface-card__copy">Добавьте план поездки и настройте личные предпочтения бюджета и комфорта.</p>
        </header>

        <form className="profile-form onboarding-profile__form" onSubmit={handleSubmit} noValidate>
          {isCompleting ? (
            <OnboardingStatusPanel
              title="Завершаем настройку"
              message="Подтверждаем данные и подготавливаем Discover / Matching…"
            />
          ) : null}
          {isSaved ? (
            <OnboardingStatusPanel
              title="Настройка завершена"
              message="Через секунду откроется Discover / Matching."
            ><button type="button" className="profile-button profile-button--primary" disabled>Завершено</button></OnboardingStatusPanel>
          ) : null}
          {completionError ? (
            <OnboardingStatusPanel
              tone="error"
              title="Не удалось завершить настройку"
              message={`Данные сохранены. ${completionError}`}
            />
          ) : null}
          {apiError ? <OnboardingStatusPanel tone="error" title="Не удалось сохранить данные" message={apiError} /> : null}
          {!apiError && (validationErrors.destination || validationErrors.dateFrom || validationErrors.dateTo) ? (
            <OnboardingStatusPanel tone="error" title="Проверьте данные поездки" message="Укажите направление и корректный диапазон дат." />
          ) : null}
          <section className="onboarding-section">
            <h2 className="surface-card__title">План первой поездки</h2>
            <div className="profile-form__section">
              <div className="onboarding-field onboarding-field--destination">
                <label className="profile-form__field">
                  <span className="profile-form__label">Направление *</span>
                  <input
                    ref={destinationInputRef}
                    className="profile-input"
                    type="text"
                    value={draft.destination}
                    onChange={handleTextChange('destination')}
                    placeholder="Куда хотите поехать?"
                    disabled={isSaving || isCompleting || isSaved}
                    aria-invalid={validationErrors.destination ? 'true' : undefined}
                    aria-describedby={validationErrors.destination ? 'onboarding-destination-error' : undefined}
                  />
                </label>
                {validationErrors.destination ? <FieldError id="onboarding-destination-error" message={validationErrors.destination} /> : null}
              </div>

              <div className="onboarding-field">
                <label className="profile-form__field">
                  <span className="profile-form__label">Дата начала</span>
                  <input
                    ref={dateFromInputRef}
                    className="profile-input"
                    type="date"
                    value={draft.dateFrom}
                    onChange={handleTextChange('dateFrom')}
                    disabled={isSaving || isCompleting || isSaved}
                    aria-invalid={validationErrors.dateFrom ? 'true' : undefined}
                    aria-describedby={validationErrors.dateFrom ? 'onboarding-date-from-error' : undefined}
                  />
                </label>
                {validationErrors.dateFrom ? <FieldError id="onboarding-date-from-error" message={validationErrors.dateFrom} /> : null}
              </div>

              <div className="onboarding-field">
                <label className="profile-form__field">
                  <span className="profile-form__label">Дата окончания</span>
                  <input
                    ref={dateToInputRef}
                    className="profile-input"
                    type="date"
                    value={draft.dateTo}
                    onChange={handleTextChange('dateTo')}
                    disabled={isSaving || isCompleting || isSaved}
                    aria-invalid={validationErrors.dateTo ? 'true' : undefined}
                    aria-describedby={validationErrors.dateTo ? 'onboarding-date-to-error' : undefined}
                  />
                </label>
                {validationErrors.dateTo ? <FieldError id="onboarding-date-to-error" message={validationErrors.dateTo} /> : null}
              </div>
            </div>
          </section>

          <section className="onboarding-section">
            <h2 className="surface-card__title">Бюджет</h2>
            <p className="surface-card__copy">Личный уровень бюджета, не бюджет совместной поездки.</p>
            <LevelSelector
              legend="Личный уровень бюджета"
              name="onboarding-budget"
              value={budgetLevel}
              options={BUDGET_OPTIONS}
              disabled={isSaving || isCompleting || isSaved}
              onChange={(level) => {
                setBudgetLevel(level);
                setIsSaved(false);
                setIsTripDataSaved(false);
                savedTravelIntentRef.current = null;
                setCompletionError(null);
              }}
              iconSrc="/figma-assets/budget-low.svg"
              compactScale
              rangeLabels={['низкий бюджет', 'высокий бюджет']}
            />
          </section>

          <section className="onboarding-section">
            <h2 className="surface-card__title">Комфорт</h2>
            <LevelSelector
              legend="Личный уровень комфорта"
              name="onboarding-comfort"
              value={comfortLevel}
              options={COMFORT_OPTIONS}
              disabled={isSaving || isCompleting || isSaved}
              onChange={(level) => {
                setComfortLevel(level);
                setIsSaved(false);
                setIsTripDataSaved(false);
                savedTravelIntentRef.current = null;
                setCompletionError(null);
              }}
              iconSrc="/figma-assets/comfort-low.svg"
              compactScale
              rangeLabels={['низкий комфорт', 'высокий комфорт']}
            />
          </section>

          {!isSaved ? <div className="profile-actions">
            <button type="submit" className="profile-button profile-button--primary" disabled={isSaving || isCompleting || isSaved}>
              {isSaving ? 'Сохранение…'
                : isCompleting ? 'Завершение…'
                  : isTripDataSaved && completionError ? 'Повторить завершение'
                      : 'Завершить настройку'}
            </button>
          </div> : null}
        </form>
      </section>
    </main>
  );
}

function FieldError({ id, message }: Readonly<{ id: string; message: string }>) {
  return <p className="profile-field-error" id={id} role="alert">{message}</p>;
}

function TravelIntentMessage({ title, message }: Readonly<{ title: string; message: string }>) {
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
