'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { BuddyCard } from '@/components/BuddyCard';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  createBackendApiClient,
  type DiscoverDecision
} from '@/lib/backend-api-client';
import {
  createInitialDiscoverState,
  discoverReducer,
  getCurrentDiscoverCandidate,
  toDiscoverCardCandidate
} from '@/lib/discover-runtime';

const backendApiClient = createBackendApiClient();

export default function HomePage() {
  const { session } = useTelegramAuthSession();
  const [state, dispatch] = useReducer(discoverReducer, undefined, createInitialDiscoverState);
  const isSubmittingRef = useRef(false);

  const loadCandidates = useCallback(async () => {
    if (!session) {
      return;
    }

    dispatch({ type: 'load_started' });

    try {
      const candidates = await backendApiClient.getDiscoverCandidates(session.accessToken);
      dispatch({ type: 'load_succeeded', candidates });
    } catch {
      dispatch({ type: 'load_failed' });
    }
  }, [session]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const activeCandidate = getCurrentDiscoverCandidate(state);

  const submitDecision = useCallback(async (decision: DiscoverDecision) => {
    if (!session || !activeCandidate || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    dispatch({ type: 'decision_started' });

    try {
      await backendApiClient.putDiscoverDecision(session.accessToken, activeCandidate.user_id, { decision });
      dispatch({ type: 'decision_succeeded' });
    } catch {
      dispatch({ type: 'decision_failed' });
    } finally {
      isSubmittingRef.current = false;
    }
  }, [activeCandidate, session]);

  return (
    <section className="page">
      <article className="hero-card">
        <h1 className="hero-card__title">Найдите попутчика</h1>
      </article>

      {state.loading ? (
        <section className="discover-list" aria-live="polite">
          <p className="surface-card surface-card--compact">Загружаем анкеты…</p>
        </section>
      ) : null}

      {state.loadError ? (
        <section className="discover-list" aria-live="polite">
          <article className="surface-card surface-card--compact empty-state-card">
            <h2 className="empty-state-card__title">Не удалось загрузить анкеты</h2>
            <button type="button" className="profile-button profile-button--secondary" onClick={() => void loadCandidates()}>
              Повторить
            </button>
          </article>
        </section>
      ) : null}

      {!state.loading && !state.loadError && activeCandidate ? (
        <section className="discover-list" aria-label="Активная карточка попутчика">
          <BuddyCard
            buddy={toDiscoverCardCandidate(activeCandidate)}
            disabled={state.submitting}
            onDismiss={() => void submitDecision('rejected')}
            onInterested={() => void submitDecision('interested')}
          />
          {state.decisionError ? (
            <p className="surface-card surface-card--compact" role="alert">
              Не удалось сохранить решение. Попробуйте ещё раз.
            </p>
          ) : null}
        </section>
      ) : null}

      {!state.loading && !state.loadError && !activeCandidate ? (
        <section className="discover-list" aria-label="Новых кандидатов нет">
          <article className="surface-card surface-card--compact empty-state-card">
            <h2 className="empty-state-card__title">Сейчас новых кандидатов нет</h2>
          </article>
        </section>
      ) : null}
    </section>
  );
}
