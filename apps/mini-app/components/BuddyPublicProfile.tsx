'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { DiscoverMatchFeedback } from '@/components/DiscoverMatchFeedback';
import { ProfileBackButton } from '@/components/ProfileBackButton';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { ApiError, createBackendApiClient, type DiscoverCandidateResponse, type DiscoverDecision } from '@/lib/backend-api-client';
import { getDiscoverLevelLabels } from '@/lib/discover-runtime';
import { formatRussianDateRange } from '@/lib/russian-date-format';
import { getAvatarInitials } from '@/lib/travel-preferences';
import { findDiscoverCandidateById, getDiscoverPublicProfileState } from '@/lib/discover-public-profile-runtime';

const backendApiClient = createBackendApiClient();

interface BuddyPublicProfileProps {
  userId: string;
}

type SavedDecision = Readonly<{
  decision: DiscoverDecision;
  matchId: string | null;
}>;

export function BuddyPublicProfile({ userId }: BuddyPublicProfileProps) {
  const { session } = useTelegramAuthSession();
  const [candidate, setCandidate] = useState<DiscoverCandidateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [savedDecision, setSavedDecision] = useState<SavedDecision | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;
    void backendApiClient.getDiscoverCandidates(session.accessToken).then((candidates) => {
      if (!isCurrent) {
        return;
      }

      setCandidate(findDiscoverCandidateById(candidates, userId));
      setLoadError(false);
      setIsLoading(false);
    }).catch(() => {
      if (isCurrent) {
        setCandidate(null);
        setLoadError(true);
        setIsLoading(false);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [reloadKey, session, userId]);

  const handleDecision = async (decision: DiscoverDecision) => {
    if (session === null || candidate === null || savedDecision !== null || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setDecisionError(null);

    try {
      const result = await backendApiClient.putDiscoverDecision(session.accessToken, candidate.user_id, { decision });
      setSavedDecision({ decision: result.decision, matchId: result.match_id });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        setCandidate(null);
        setLoadError(false);
      } else {
        setDecisionError('Не удалось сохранить решение. Проверьте подключение и попробуйте ещё раз.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const profileState = getDiscoverPublicProfileState({
    isLoading,
    hasError: loadError || session === null,
    candidate
  });

  if (profileState === 'loading') {
    return <ProfileMessage title="Загружаем профиль" message="Получаем данные анкеты." />;
  }

  if (profileState === 'error') {
    return (
      <ProfileMessage
        title="Не удалось загрузить профиль"
        message="Проверьте подключение и попробуйте ещё раз. Возможно, сессия устарела."
        action={(
          <button
            className="profile-button profile-button--secondary"
            type="button"
            onClick={() => {
              setIsLoading(true);
              setLoadError(false);
              setReloadKey((key) => key + 1);
            }}
          >
            Повторить
          </button>
        )}
      />
    );
  }

  if (profileState === 'unavailable' || candidate === null) {
    return (
      <ProfileMessage
        title="Анкета недоступна"
        message="Она могла быть скрыта или решение по ней уже сохранено. Вернитесь к списку анкет."
        action={<Link className="profile-button profile-button--secondary" href="/">К списку анкет</Link>}
      />
    );
  }

  const levels = getDiscoverLevelLabels(candidate.budget_level, candidate.comfort_level);
  const formattedDates = formatRussianDateRange(candidate.travel_intent.date_from, candidate.travel_intent.date_to);

  return (
    <section className="page">
      <article className="hero-card">
        <div className="profile-header">
          <ProfileBackButton />
          <span className="profile-status">Анкета попутчика</span>
        </div>
        <p className="section-kicker">Публичный профиль</p>
        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">{getAvatarInitials(candidate.display_name)}</div>
          <div className="profile-hero__content">
            <h1 className="hero-card__title profile-hero__title">
              {candidate.display_name}{candidate.age === null ? '' : `, ${candidate.age}`}
            </h1>
            {candidate.city ? <p className="profile-hero__city">{candidate.city}</p> : null}
          </div>
        </div>
        {candidate.bio ? <p className="public-profile__tagline">{candidate.bio}</p> : null}
        {levels.budget || levels.comfort ? (
          <div className="chip-row" aria-label="Предпочтения в поездках">
            {levels.budget ? <span className="chip">Бюджет {levels.budget}</span> : null}
            {levels.comfort ? <span className="chip">{levels.comfort}</span> : null}
          </div>
        ) : null}
      </article>

      <section className="card-grid" aria-label="Информация об анкете">
        <ProfileSection title="Направление">
          <p className="surface-card__copy">{candidate.travel_intent.destination}</p>
          {formattedDates ? <p className="surface-card__note">Даты: {formattedDates}</p> : null}
        </ProfileSection>
        <ProfileSection title="Интересы">
          <ChipList values={candidate.interests} emptyMessage="Интересы не указаны." />
        </ProfileSection>
        <ProfileSection title="Стиль отдыха">
          <ChipList values={candidate.travel_style} emptyMessage="Стиль отдыха не указан." />
        </ProfileSection>
      </section>

      {savedDecision !== null && savedDecision.matchId !== null ? (
        <section className="discover-list" aria-live="polite">
          <DiscoverMatchFeedback displayName={candidate.display_name} />
        </section>
      ) : savedDecision !== null ? (
        <article className="surface-card surface-card--compact" role="status">
          <p className="surface-card__copy">
            {savedDecision.decision === 'interested' ? 'Интерес сохранён.' : 'Решение сохранено.'}
          </p>
          <Link className="profile-button profile-button--secondary" href="/">К списку анкет</Link>
        </article>
      ) : (
        <article className="surface-card surface-card--compact surface-card--wide">
          <p className="surface-card__title">Подходит ли вам этот попутчик?</p>
          {decisionError ? <p className="profile-field-error" role="alert">{decisionError}</p> : null}
          <div className="profile-actions">
            <button
              type="button"
              className="profile-button profile-button--secondary"
              onClick={() => void handleDecision('rejected')}
              disabled={isSubmitting}
            >
              Не подходит
            </button>
            <button
              type="button"
              className="profile-button profile-button--primary"
              onClick={() => void handleDecision('interested')}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Сохраняем…' : 'Подходит'}
            </button>
          </div>
        </article>
      )}
    </section>
  );
}

function ProfileSection({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return <article className="surface-card"><p className="surface-card__title">{title}</p>{children}</article>;
}

function ChipList({ values, emptyMessage }: Readonly<{ values: readonly string[]; emptyMessage: string }>) {
  return values.length > 0 ? (
    <div className="chip-row">{values.map((value) => <span className="chip" key={value}>{value}</span>)}</div>
  ) : <p className="surface-card__note">{emptyMessage}</p>;
}

function ProfileMessage({
  title,
  message,
  action
}: Readonly<{ title: string; message: string; action?: React.ReactNode }>) {
  return (
    <section className="page" aria-live="polite">
      <article className="surface-card surface-card--compact empty-state-card">
        <ProfileBackButton />
        <h1 className="empty-state-card__title">{title}</h1>
        <p className="surface-card__copy">{message}</p>
        {action}
      </article>
    </section>
  );
}
