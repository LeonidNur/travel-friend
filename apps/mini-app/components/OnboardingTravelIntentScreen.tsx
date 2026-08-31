'use client';

import { ChangeEvent, FormEvent, useRef, useState } from 'react';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type TravelIntentResponse } from '@/lib/backend-api-client';
import {
  createOnboardingTravelIntentDraft,
  saveOnboardingTravelIntent,
  type OnboardingTravelIntentDraft,
  type OnboardingTravelIntentValidationErrors
} from '@/lib/onboarding-travel-intent';
import { completeOnboarding } from '@/lib/onboarding-completion';

const backendApiClient = createBackendApiClient();

export function OnboardingTravelIntentScreen({ onBack }: Readonly<{ onBack: () => void }>) {
  const { session, markOnboardingCompleted } = useTelegramAuthSession();
  const { serverTravelIntent, setServerTravelIntent } = useCurrentUserProfile();

  if (serverTravelIntent.status === 'loading') {
    return <TravelIntentMessage title="Загружаем план поездки" message="Проверяем сохранённые данные." />;
  }

  if (serverTravelIntent.status === 'error') {
    return <TravelIntentMessage title="Не удалось загрузить план поездки" message="Попробуйте открыть приложение ещё раз." />;
  }

  return (
    <OnboardingTravelIntentForm
      travelIntent={serverTravelIntent.travelIntent}
      token={session?.accessToken ?? null}
      onBack={onBack}
      onTravelIntentSaved={setServerTravelIntent}
      onOnboardingCompleted={markOnboardingCompleted}
    />
  );
}

function OnboardingTravelIntentForm({
  travelIntent,
  token,
  onBack,
  onTravelIntentSaved,
  onOnboardingCompleted
}: Readonly<{
  travelIntent: TravelIntentResponse | null;
  token: string | null;
  onBack: () => void;
  onTravelIntentSaved: (travelIntent: TravelIntentResponse) => void;
  onOnboardingCompleted: () => void;
}>) {
  const [draft, setDraft] = useState<OnboardingTravelIntentDraft>(() => createOnboardingTravelIntentDraft(travelIntent));
  const [validationErrors, setValidationErrors] = useState<OnboardingTravelIntentValidationErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const destinationInputRef = useRef<HTMLInputElement>(null);

  const handleTextChange =
    (field: 'destination' | 'dateFrom' | 'dateTo') => (event: ChangeEvent<HTMLInputElement>) => {
      setDraft({ ...draft, [field]: event.target.value });
      setIsSaved(false);
      setCompletionError(null);
      setValidationErrors((errors) => ({ ...errors, [field]: undefined }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (token === null) {
      setApiError('Сессия недоступна. Откройте приложение ещё раз.');
      return;
    }

    setIsSaving(true);
    setApiError(null);
    const result = await saveOnboardingTravelIntent({
      draft,
      token,
      putTravelIntent: backendApiClient.putTravelIntent
    });
    setIsSaving(false);

    if (result.status === 'validation_error') {
      setValidationErrors(result.errors);
      if (result.errors.destination) {
        destinationInputRef.current?.focus();
      }
      return;
    }

    if (result.status === 'api_error') {
      setApiError(result.message);
      return;
    }

    onTravelIntentSaved(result.travelIntent);
    setDraft(createOnboardingTravelIntentDraft(result.travelIntent));
    setValidationErrors({});
    setIsSaved(true);
  };

  const handleCompletion = async () => {
    if (token === null) {
      setCompletionError('Сессия недоступна. Откройте приложение ещё раз.');
      return;
    }

    setIsCompleting(true);
    setCompletionError(null);
    const result = await completeOnboarding({
      token,
      patchOnboarding: backendApiClient.patchOnboarding,
      applyCompletedState: onOnboardingCompleted
    });

    if (result.status === 'api_error') {
      setIsCompleting(false);
      setCompletionError(result.message);
    }
  };

  return (
    <main className="auth-gate onboarding-profile" aria-live="polite">
      <section className="surface-card auth-gate__card">
        <p className="section-kicker">Шаг 2 из 2</p>
        <h1 className="auth-gate__title">План первой поездки</h1>
        <p className="surface-card__copy">Укажите направление и, если уже знаете, даты путешествия.</p>

        <form className="profile-form onboarding-profile__form" onSubmit={handleSubmit} noValidate>
          <label className="profile-form__field">
            <span className="profile-form__label">Направление *</span>
            <input
              ref={destinationInputRef}
              className="profile-input"
              type="text"
              value={draft.destination}
              onChange={handleTextChange('destination')}
              placeholder="Например, Тбилиси"
              disabled={isSaving}
              aria-invalid={validationErrors.destination ? 'true' : undefined}
              aria-describedby={validationErrors.destination ? 'onboarding-destination-error' : undefined}
            />
            {validationErrors.destination ? <FieldError id="onboarding-destination-error" message={validationErrors.destination} /> : null}
          </label>

          <label className="profile-form__field">
            <span className="profile-form__label">Дата начала</span>
            <input
              className="profile-input"
              type="date"
              value={draft.dateFrom}
              onChange={handleTextChange('dateFrom')}
              disabled={isSaving}
              aria-invalid={validationErrors.dateFrom ? 'true' : undefined}
              aria-describedby={validationErrors.dateFrom ? 'onboarding-date-from-error' : undefined}
            />
            {validationErrors.dateFrom ? <FieldError id="onboarding-date-from-error" message={validationErrors.dateFrom} /> : null}
          </label>

          <label className="profile-form__field">
            <span className="profile-form__label">Дата окончания</span>
            <input
              className="profile-input"
              type="date"
              value={draft.dateTo}
              onChange={handleTextChange('dateTo')}
              disabled={isSaving}
              aria-invalid={validationErrors.dateTo ? 'true' : undefined}
              aria-describedby={validationErrors.dateTo ? 'onboarding-date-to-error' : undefined}
            />
            {validationErrors.dateTo ? <FieldError id="onboarding-date-to-error" message={validationErrors.dateTo} /> : null}
          </label>

          {apiError ? <p className="profile-field-error" role="alert">{apiError}</p> : null}
          {isSaved ? <p className="onboarding-profile__saved" role="status">План поездки сохранён.</p> : null}
          {completionError ? <p className="profile-field-error" role="alert">{completionError}</p> : null}

          <div className="profile-actions">
            <button type="submit" className="profile-button profile-button--primary" disabled={isSaving}>
              {isSaving ? 'Сохраняем…' : 'Сохранить план'}
            </button>
            <button type="button" className="profile-button profile-button--secondary" onClick={onBack} disabled={isSaving}>
              Назад к профилю
            </button>
            {isSaved ? (
              <button type="button" className="profile-button profile-button--secondary" onClick={handleCompletion} disabled={isCompleting}>
                {isCompleting ? 'Завершаем…' : 'Завершить настройку'}
              </button>
            ) : null}
          </div>
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
