'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { ChipSelector, LevelSelector } from '@/components/ProfileSelectors';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type ProfileResponse } from '@/lib/backend-api-client';
import { calculateAgeFromBirthDate } from '@/lib/current-user-profile-hydration';
import { createProfileEditingDraft, saveProfileEditing, type ProfileEditingDraft } from '@/lib/profile-editing';
import {
  BUDGET_OPTIONS, COMFORT_OPTIONS, INTEREST_OPTIONS, TRAVEL_STYLE_OPTIONS, getAvatarInitials,
  fromCanonicalProfileLevel, getBudgetLabel, getComfortLabel, toggleMultiValue
} from '@/lib/travel-preferences';

const backendApiClient = createBackendApiClient();

type DetailItem = { label: string; value: string };

function levelLabel(value: string | null, getLabel: (level: 1 | 2 | 3 | 4) => string) {
  const level = fromCanonicalProfileLevel(value);

  return level === null ? 'Не указан' : getLabel(level) || 'Не указан';
}

function createDetailItems(profile: ProfileResponse): DetailItem[] {
  return [
    { label: 'Бюджет', value: levelLabel(profile.budget_level, getBudgetLabel) },
    { label: 'Стиль путешествий', value: profile.travel_style.filter((value): value is string => value !== null).join(', ') || 'Не указан' },
    { label: 'Уровень комфорта', value: levelLabel(profile.comfort_level, getComfortLabel) }
  ];
}

function DetailList({ items }: { items: readonly DetailItem[] }) {
  return <dl className="detail-list">{items.map((item) => <div className="detail-list__item" key={item.label}><dt className="detail-list__label">{item.label}</dt><dd className="detail-list__value">{item.value}</dd></div>)}</dl>;
}

function ProfileMessage({ title, message }: Readonly<{ title: string; message: string }>) {
  return <section className="page"><article className="surface-card"><p className="section-kicker">Профиль</p><h1 className="hero-card__title">{title}</h1><p className="surface-card__copy">{message}</p></article></section>;
}

export default function ProfilePage() {
  const { serverProfile, setServerProfile } = useCurrentUserProfile();
  const { session } = useTelegramAuthSession();
  const [draftProfile, setDraftProfile] = useState<ProfileEditingDraft | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.dataset.profileEditMode = isEditing ? 'true' : 'false';
    return () => { delete document.body.dataset.profileEditMode; };
  }, [isEditing]);

  if (serverProfile.status === 'loading') return <ProfileMessage title="Загружаем профиль" message="Получаем ваши данные путешественника." />;
  if (serverProfile.status === 'error') return <ProfileMessage title="Не удалось загрузить профиль" message="Проверьте подключение и откройте приложение ещё раз." />;
  if (serverProfile.profile === null) return <ProfileMessage title="Профиль пока не создан" message="Завершите настройку профиля, чтобы увидеть его здесь." />;

  const profile = serverProfile.profile;
  const activeDraft = draftProfile ?? createProfileEditingDraft(profile);
  const age = profile.birth_date === null ? null : calculateAgeFromBirthDate(profile.birth_date);
  const interests = profile.interests.filter((interest): interest is string => interest !== null);

  const updateDraft = (nextDraft: ProfileEditingDraft) => {
    setDraftProfile(nextDraft);
    setApiError(null);
  };
  const handleEditStart = () => { updateDraft(createProfileEditingDraft(profile)); setIsEditing(true); };
  const handleCancel = () => { updateDraft(createProfileEditingDraft(profile)); setIsEditing(false); };
  const handleTextChange = (field: 'displayName' | 'birthDate' | 'city' | 'bio') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateDraft({ ...activeDraft, [field]: event.target.value });
  const handleSave = async () => {
    if (session === null || isSaving) { setApiError('Сессия недоступна. Откройте приложение ещё раз.'); return; }
    setIsSaving(true); setApiError(null);
    const result = await saveProfileEditing({ draft: activeDraft, sourceProfile: profile, token: session.accessToken, patchProfile: backendApiClient.patchProfile });
    setIsSaving(false);
    if (result.status === 'validation_error') { setApiError(Object.values(result.errors)[0] ?? 'Проверьте данные профиля.'); nameInputRef.current?.focus(); return; }
    if (result.status === 'api_error') { setApiError(result.message); return; }
    setServerProfile(result.profile);
    setDraftProfile(createProfileEditingDraft(result.profile));
    setIsEditing(false);
  };

  return (
    <section className="page">
      <article className="hero-card"><div className="profile-header"><p className="section-kicker">Профиль</p>{isEditing ? <span className="profile-status">Editing</span> : <button type="button" className="profile-action" onClick={handleEditStart}>Edit profile</button>}</div><div className="profile-hero"><div className="profile-hero__avatar" aria-hidden="true">{getAvatarInitials(profile.display_name)}</div><div className="profile-hero__content"><h2 className="hero-card__title profile-hero__title">{profile.display_name}{age === null ? '' : `, ${age}`}</h2><p className="profile-hero__city">{profile.city ?? 'Город не указан'}</p></div></div></article>
      {isEditing ? <article className="surface-card"><div className="profile-form">
        <div className="profile-form__section"><p className="surface-card__title">Основное</p>
          <label className="profile-form__field"><span className="profile-form__label">Имя</span><input ref={nameInputRef} className="profile-input" type="text" value={activeDraft.displayName} onChange={handleTextChange('displayName')} placeholder="Как вас зовут" disabled={isSaving} /></label>
          <label className="profile-form__field"><span className="profile-form__label">Дата рождения</span><input className="profile-input" type="date" value={activeDraft.birthDate} onChange={handleTextChange('birthDate')} disabled={isSaving} /></label>
          <label className="profile-form__field"><span className="profile-form__label">Город</span><input className="profile-input" type="text" value={activeDraft.city} onChange={handleTextChange('city')} placeholder="Город" disabled={isSaving} /></label>
          <label className="profile-form__field"><span className="profile-form__label">О себе</span><textarea className="profile-input onboarding-profile__textarea" value={activeDraft.bio} onChange={handleTextChange('bio')} disabled={isSaving} /></label>
        </div>
        <div className="profile-form__section"><p className="surface-card__title">Интересы</p><ChipSelector options={INTEREST_OPTIONS} selectedValues={activeDraft.interests} onToggle={(value) => { if (!isSaving) updateDraft({ ...activeDraft, interests: toggleMultiValue(activeDraft.interests, value) }); }} /></div>
        <div className="profile-form__section"><p className="surface-card__title">Travel preferences</p><LevelSelector legend="Бюджет" name="budget" value={activeDraft.budgetLevel} options={BUDGET_OPTIONS} disabled={isSaving} onChange={(budgetLevel) => updateDraft({ ...activeDraft, budgetLevel })} /><div className="profile-form__field"><span className="profile-form__label">Стиль путешествий</span><ChipSelector options={TRAVEL_STYLE_OPTIONS} selectedValues={activeDraft.travelStyle} onToggle={(value) => { if (!isSaving) updateDraft({ ...activeDraft, travelStyle: toggleMultiValue(activeDraft.travelStyle, value) }); }} /></div><LevelSelector legend="Уровень комфорта" name="comfort" value={activeDraft.comfortLevel} options={COMFORT_OPTIONS} disabled={isSaving} onChange={(comfortLevel) => updateDraft({ ...activeDraft, comfortLevel })} /></div>
        {apiError ? <p className="profile-field-error" role="alert">{apiError}</p> : null}<div className="profile-actions"><button type="button" className="profile-button profile-button--primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Save'}</button><button type="button" className="profile-button profile-button--secondary" onClick={handleCancel} disabled={isSaving}>Cancel</button></div>
      </div></article> : null}
      <section className="card-grid" aria-label="Профиль пользователя"><article className="surface-card"><p className="surface-card__title">О себе</p><p className="surface-card__copy">{profile.bio ?? 'Пользователь пока не добавил описание.'}</p></article><article className="surface-card"><p className="surface-card__title">Интересы</p><div className="chip-row" aria-label="Интересы путешествий">{interests.length > 0 ? interests.map((interest) => <span className="chip" key={interest}>{interest}</span>) : <span className="surface-card__note">Не указаны</span>}</div></article><article className="surface-card"><p className="surface-card__title">Travel preferences</p><DetailList items={createDetailItems(profile)} /></article></section>
    </section>
  );
}
