'use client';

import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import Image from 'next/image';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { ChipSelector, LevelSelector } from '@/components/ProfileSelectors';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type TravelIntentResponse } from '@/lib/backend-api-client';
import { calculateAgeFromBirthDate } from '@/lib/current-user-profile-hydration';
import { createProfileEditingDraft, saveProfileEditing, type ProfileEditingDraft } from '@/lib/profile-editing';
import type { OnboardingProfileValidationErrors } from '@/lib/onboarding-profile';
import { focusFirstValidationErrorField } from '@/lib/form-validation-focus';
import { formatRussianDateRange } from '@/lib/russian-date-format';
import {
  createProfileTravelIntentDraft,
  saveProfileTravelIntent,
  type ProfileTravelIntentDraft,
  type ProfileTravelIntentValidationErrors
} from '@/lib/profile-travel-intent';
import {
  BUDGET_OPTIONS, COMFORT_OPTIONS, INTEREST_OPTIONS, TRAVEL_STYLE_OPTIONS,
  fromCanonicalProfileLevel, toggleMultiValue
} from '@/lib/travel-preferences';

const backendApiClient = createBackendApiClient();

function PreferenceLevel({ label, value, icon }: Readonly<{ label: string; value: string | null; icon: string }>) {
  const level = fromCanonicalProfileLevel(value);
  return <div className="profile-design__level" aria-label={`${label}: ${level === null ? 'не указан' : `${level} из 4`}`}><span>{label}:</span>{level === null ? <span>Не указан</span> : Array.from({ length: level }, (_, index) => <Image key={index} src={icon} width={24} height={24} alt="" />)}</div>;
}

function ProfileMessage({ title, message, onRetry }: Readonly<{ title: string; message: string; onRetry?: () => void }>) {
  return <section className="page"><article className="surface-card"><p className="section-kicker">Профиль</p><h1 className="hero-card__title">{title}</h1><p className="surface-card__copy">{message}</p>{onRetry ? <button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button> : null}</article></section>;
}

export default function ProfilePage() {
  const data = useCurrentUserProfile();
  const { session } = useTelegramAuthSession();
  return <ProfileContent {...data} token={session?.accessToken ?? null} />;
}

type ProfileContentProps = Pick<ReturnType<typeof useCurrentUserProfile>, 'serverProfile' | 'setServerProfile' | 'reloadServerProfile' | 'serverTravelIntent' | 'setServerTravelIntent' | 'reloadServerTravelIntent'> & Readonly<{
  token: string | null;
  patchProfile?: ReturnType<typeof createBackendApiClient>['patchProfile'];
  initialView?: 'view' | 'edit' | 'saved' | 'validation' | 'saving' | 'error';
}>;

export function ProfileContent({
    serverProfile,
    setServerProfile,
    reloadServerProfile,
    serverTravelIntent,
    setServerTravelIntent,
    reloadServerTravelIntent,
    token,
    patchProfile = backendApiClient.patchProfile,
    initialView = 'view'
}: ProfileContentProps) {
  const [draftProfile, setDraftProfile] = useState<ProfileEditingDraft | null>(null);
  const [isEditing, setIsEditing] = useState(['edit', 'validation', 'saving', 'error'].includes(initialView));
  const [isSaved, setIsSaved] = useState(initialView === 'saved');
  const [apiError, setApiError] = useState<string | null>(initialView === 'error' ? 'Не удалось сохранить профиль.' : null);
  const [isSaving, setIsSaving] = useState(initialView === 'saving');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const birthDateInputRef = useRef<HTMLInputElement>(null);
  const [validationErrors, setValidationErrors] = useState<OnboardingProfileValidationErrors>(initialView === 'validation' ? { displayName: 'Укажите имя' } : {});

  if (serverProfile.status === 'loading') return <ProfileMessage title="Загружаем профиль" message="Получаем ваши данные путешественника." />;
  if (serverProfile.status === 'error') return <ProfileMessage title="Не удалось загрузить профиль" message="Проверьте подключение и попробуйте ещё раз." onRetry={reloadServerProfile} />;
  if (serverProfile.profile === null) return <ProfileMessage title="Профиль пока не создан" message="Завершите настройку профиля, чтобы увидеть его здесь." />;

  const profile = serverProfile.profile;
  const activeDraft = draftProfile ?? createProfileEditingDraft(profile);
  const age = profile.birth_date === null ? null : calculateAgeFromBirthDate(profile.birth_date);
  const interests = profile.interests.filter((interest): interest is string => interest !== null);
  const travelStyles = profile.travel_style.filter((style): style is string => style !== null);

  const updateDraft = (nextDraft: ProfileEditingDraft) => {
    setDraftProfile(nextDraft);
    setApiError(null);
  };
  const handleEditStart = () => { updateDraft(createProfileEditingDraft(profile)); setValidationErrors({}); setIsSaved(false); setIsEditing(true); };
  const handleCancel = () => { updateDraft(createProfileEditingDraft(profile)); setValidationErrors({}); setIsEditing(false); };
  const handleTextChange = (field: 'displayName' | 'birthDate' | 'city' | 'bio') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    updateDraft({ ...activeDraft, [field]: event.target.value });
    if (field === 'displayName' || field === 'birthDate') {
      setValidationErrors((errors) => ({ ...errors, [field]: undefined }));
    }
  };
  const handleSave = async () => {
    if (token === null || isSaving) { setApiError('Сессия недоступна. Откройте приложение ещё раз.'); return; }
    setIsSaving(true); setApiError(null);
    const result = await saveProfileEditing({ draft: activeDraft, sourceProfile: profile, token, patchProfile });
    setIsSaving(false);
    if (result.status === 'validation_error') {
      setValidationErrors(result.errors);
      focusFirstValidationErrorField(result.errors, ['displayName', 'birthDate'], {
        displayName: nameInputRef.current,
        birthDate: birthDateInputRef.current
      });
      return;
    }
    if (result.status === 'api_error') { setApiError(result.message); return; }
    setServerProfile(result.profile);
    setValidationErrors({});
    setDraftProfile(createProfileEditingDraft(result.profile));
    setIsEditing(false);
    setIsSaved(true);
  };

  return (
    <section className="page profile-design">
      {isSaved && !isEditing ? <article className="profile-design__notice" role="status"><strong>Профиль сохранён</strong><p>Изменения сохранены.</p></article> : null}
      <div hidden={isEditing} className="profile-design__view">
      <article className="hero-card profile-page__identity"><div className="profile-header"><p className="section-kicker">Профиль</p>{isEditing ? <span className="profile-status">Редактирование</span> : <button type="button" className="profile-action" onClick={handleEditStart}>Изменить профиль</button>}</div><div className="profile-hero"><div className="profile-hero__avatar" aria-hidden="true"><Image className="profile-hero__avatar-image" src="/figma-assets/profile-placeholder.png" width={740} height={740} alt="" /></div><div className="profile-hero__content"><h2 className="hero-card__title profile-hero__title">{profile.display_name}{age === null ? '' : `, ${age}`}</h2><p className="profile-hero__city">{profile.city ?? 'Город не указан'}</p></div></div></article>
      </div>
      {isEditing ? <div className="profile-form profile-design__edit">
        {apiError ? <article className="profile-design__notice profile-design__notice--error" role="alert"><strong>Не удалось сохранить</strong><p>Черновик сохранён. Проверьте соединение и повторите сохранение.</p><p>{apiError}</p></article> : null}
        <article className="surface-card profile-design__photo"><p className="surface-card__title">Основная фотография</p><div className="profile-design__photo-row"><Image src="/figma-assets/profile-placeholder.png" width={152} height={152} alt="" /><button type="button" className="profile-button profile-button--primary" disabled aria-describedby="photo-unavailable">Изменить фото</button></div><p id="photo-unavailable" className="surface-card__note">Загрузка фото пока недоступна.</p></article>
        <div className="surface-card profile-form__section"><p className="surface-card__title">Основная информация</p>
          <label className="profile-form__field"><span className="profile-form__label">Имя</span><input ref={nameInputRef} className="profile-input" type="text" value={activeDraft.displayName} onChange={handleTextChange('displayName')} placeholder="Как вас зовут" disabled={isSaving} aria-invalid={validationErrors.displayName ? 'true' : undefined} aria-describedby={validationErrors.displayName ? 'profile-name-error' : undefined} />{validationErrors.displayName ? <p className="profile-field-error" id="profile-name-error" role="alert">{validationErrors.displayName}</p> : null}</label>
          <label className="profile-form__field"><span className="profile-form__label">Дата рождения</span><input ref={birthDateInputRef} className="profile-input" type="date" value={activeDraft.birthDate} onChange={handleTextChange('birthDate')} disabled={isSaving} aria-invalid={validationErrors.birthDate ? 'true' : undefined} aria-describedby={validationErrors.birthDate ? 'profile-birth-date-error' : undefined} />{validationErrors.birthDate ? <p className="profile-field-error" id="profile-birth-date-error" role="alert">{validationErrors.birthDate}</p> : null}</label>
          <label className="profile-form__field"><span className="profile-form__label">Город</span><input className="profile-input" type="text" value={activeDraft.city} onChange={handleTextChange('city')} placeholder="Город" disabled={isSaving} /></label>
        </div>
        <label className="surface-card profile-design__bio"><span className="surface-card__title">О себе</span><textarea className="profile-input" value={activeDraft.bio} onChange={handleTextChange('bio')} disabled={isSaving} /></label>
        <div className="surface-card profile-form__section"><p className="surface-card__title">Интересы</p><ChipSelector options={INTEREST_OPTIONS} selectedValues={activeDraft.interests} disabled={isSaving} onToggle={(value) => { if (!isSaving) updateDraft({ ...activeDraft, interests: toggleMultiValue(activeDraft.interests, value) }); }} /></div>
        <div className="surface-card profile-form__section"><p className="surface-card__title">Стиль поездки</p><ChipSelector options={TRAVEL_STYLE_OPTIONS} selectedValues={activeDraft.travelStyle} disabled={isSaving} onToggle={(value) => { if (!isSaving) updateDraft({ ...activeDraft, travelStyle: toggleMultiValue(activeDraft.travelStyle, value) }); }} /></div>
        <div className="surface-card profile-form__section"><p className="surface-card__title">Параметры поездки</p><LevelSelector legend="Бюджет" name="budget" value={activeDraft.budgetLevel} options={BUDGET_OPTIONS} disabled={isSaving} onChange={(budgetLevel) => updateDraft({ ...activeDraft, budgetLevel })} iconSrc="/figma-assets/budget-low.svg" /><LevelSelector legend="Уровень комфорта" name="comfort" value={activeDraft.comfortLevel} options={COMFORT_OPTIONS} disabled={isSaving} onChange={(comfortLevel) => updateDraft({ ...activeDraft, comfortLevel })} iconSrc="/figma-assets/comfort-low.svg" /></div>
        <div className="profile-actions"><button type="button" className="profile-button profile-button--primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить'}</button><button type="button" className="profile-button profile-button--secondary" onClick={handleCancel} disabled={isSaving}>Отмена</button></div>
      </div> : null}
      <div hidden={isEditing} className="profile-design__view">
      <ProfileTravelIntent
        state={serverTravelIntent}
        token={token}
        onSaved={setServerTravelIntent}
        onRetry={reloadServerTravelIntent}
      />
      <section className="card-grid" aria-label="Профиль пользователя">
        <article className="surface-card">
          <p className="surface-card__title">О себе</p>
          <p className="surface-card__copy">{profile.bio ?? 'Пользователь пока не добавил описание.'}</p>
        </article>
        <article className="surface-card">
          <p className="surface-card__title">Интересы</p>
          <div className="chip-row" aria-label="Интересы путешествий">
            {interests.length > 0 ? interests.map((interest) => <span className="chip" key={interest}>{interest}</span>) : <span className="surface-card__note">Не указаны</span>}
          </div>
        </article>
        <article className="surface-card">
          <p className="surface-card__title">Стиль поездки</p>
          <div className="chip-row" aria-label="Стиль поездки">
            {travelStyles.length > 0 ? travelStyles.map((style) => <span className="chip" key={style}>{style}</span>) : <span className="surface-card__note">Не указан</span>}
          </div>
        </article>
        <article className="surface-card">
          <p className="surface-card__title">Параметры поездки</p>
          <PreferenceLevel label="Бюджет" value={profile.budget_level} icon="/figma-assets/budget-low.svg" />
          <PreferenceLevel label="Комфорт" value={profile.comfort_level} icon="/figma-assets/comfort-low.svg" />
        </article>
      </section>
      </div>
    </section>
  );
}

function ProfileTravelIntent({
  state,
  token,
  onSaved,
  onRetry
}: Readonly<{
  state: ReturnType<typeof useCurrentUserProfile>['serverTravelIntent'];
  token: string | null;
  onSaved: (travelIntent: TravelIntentResponse) => void;
  onRetry: () => void;
}>) {
  const [draft, setDraft] = useState<ProfileTravelIntentDraft | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ProfileTravelIntentValidationErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const dateFromInputRef = useRef<HTMLInputElement>(null);
  const dateToInputRef = useRef<HTMLInputElement>(null);

  if (state.status === 'loading') {
    return <article className="surface-card surface-card--compact"><p className="surface-card__title">Планы поездок</p><p className="surface-card__note">Загружаем план поездки…</p></article>;
  }

  if (state.status === 'error' || state.status === 'invariant_error') {
    const message = state.status === 'invariant_error'
      ? 'Не удалось подтвердить активный план поездки. Попробуйте загрузить данные ещё раз.'
      : 'Не удалось загрузить план поездки. Проверьте подключение и попробуйте ещё раз.';
    return <article className="surface-card surface-card--compact"><p className="surface-card__title">Планы поездок</p><p className="surface-card__copy">{message}</p><button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button></article>;
  }

  if (state.travelIntent === null) {
    return <article className="surface-card surface-card--compact"><p className="surface-card__title">Планы поездок</p><p className="surface-card__copy">Не удалось подтвердить активный план поездки. Попробуйте загрузить данные ещё раз.</p><button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button></article>;
  }

  const travelIntent = state.travelIntent;
  const travelDates = formatRussianDateRange(travelIntent.date_from, travelIntent.date_to);
  const activeDraft = draft ?? createProfileTravelIntentDraft(travelIntent);
  const updateDraft = (nextDraft: ProfileTravelIntentDraft) => {
    setDraft(nextDraft);
    setApiError(null);
  };
  const handleTravelIntentTextChange = (field: keyof ProfileTravelIntentDraft) => (event: ChangeEvent<HTMLInputElement>) => {
    updateDraft({ ...activeDraft, [field]: event.target.value });
    setValidationErrors((errors) => ({
      ...errors,
      [field]: undefined,
      ...(field === 'dateFrom' ? { dateTo: undefined } : {})
    }));
  };
  const handleCancel = () => {
    setDraft(createProfileTravelIntentDraft(travelIntent));
    setValidationErrors({});
    setApiError(null);
    setIsEditing(false);
  };
  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token === null || isSaving) {
      if (token === null) setApiError('Сессия недоступна. Откройте приложение ещё раз.');
      return;
    }
    setIsSaving(true);
    setApiError(null);
    const result = await saveProfileTravelIntent({ draft: activeDraft, token, putTravelIntent: backendApiClient.putTravelIntent });
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
    onSaved(result.travelIntent);
    setDraft(createProfileTravelIntentDraft(result.travelIntent));
    setValidationErrors({});
    setIsEditing(false);
  };

  return <article className="surface-card surface-card--compact"><div className="profile-header"><p className="surface-card__title">Планы поездок</p>{isEditing ? <span className="profile-status">Редактирование</span> : <button className="profile-action" type="button" onClick={() => { updateDraft(createProfileTravelIntentDraft(travelIntent)); setValidationErrors({}); setIsEditing(true); }}>Изменить</button>}</div>{isEditing ? <form className="profile-form" onSubmit={handleSave} noValidate><label className="profile-form__field"><span className="profile-form__label">Направление</span><input ref={destinationInputRef} className="profile-input" type="text" value={activeDraft.destination} onChange={handleTravelIntentTextChange('destination')} disabled={isSaving} aria-invalid={validationErrors.destination ? 'true' : undefined} />{validationErrors.destination ? <p className="profile-field-error" role="alert">{validationErrors.destination}</p> : null}</label><label className="profile-form__field"><span className="profile-form__label">Дата начала</span><input ref={dateFromInputRef} className="profile-input" type="date" value={activeDraft.dateFrom} onChange={handleTravelIntentTextChange('dateFrom')} disabled={isSaving} aria-invalid={validationErrors.dateFrom ? 'true' : undefined} />{validationErrors.dateFrom ? <p className="profile-field-error" role="alert">{validationErrors.dateFrom}</p> : null}</label><label className="profile-form__field"><span className="profile-form__label">Дата окончания</span><input ref={dateToInputRef} className="profile-input" type="date" value={activeDraft.dateTo} onChange={handleTravelIntentTextChange('dateTo')} disabled={isSaving} aria-invalid={validationErrors.dateTo ? 'true' : undefined} />{validationErrors.dateTo ? <p className="profile-field-error" role="alert">{validationErrors.dateTo}</p> : null}</label>{apiError ? <p className="profile-field-error" role="alert">{apiError}</p> : null}<div className="profile-actions"><button className="profile-button profile-button--primary" type="submit" disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить'}</button><button className="profile-button profile-button--secondary" type="button" onClick={handleCancel} disabled={isSaving}>Отмена</button></div></form> : <div><div className="chip-row"><span className="chip">{travelIntent.destination}</span></div>{travelDates ? <p className="surface-card__note">{travelDates}</p> : null}</div>}</article>;
}
