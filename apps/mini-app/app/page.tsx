'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';

import { BuddyCard } from '@/components/BuddyCard';
import { DiscoverMatchFeedback } from '@/components/DiscoverMatchFeedback';
import { DiscoverStatePanel } from '@/components/DiscoverStatePanel';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  ApiError,
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
  const [lastDecision, setLastDecision] = useState<DiscoverDecision | null>(null);

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
    setLastDecision(decision);
    dispatch({ type: 'decision_started' });

    try {
      const decisionResponse = await backendApiClient.putDiscoverDecision(
        session.accessToken,
        activeCandidate.user_id,
        { decision }
      );
      dispatch({
        type: 'decision_succeeded',
        matchFeedback: decisionResponse.match_id === null
          ? null
          : { matchId: decisionResponse.match_id, displayName: activeCandidate.display_name }
      });
    } catch (error) {
      // Another tab may have already made this final decision. Reload the server-owned
      // eligible candidate list so the card cannot submit a stale decision again.
      dispatch({ type: 'decision_failed' });
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void loadCandidates();
      }
    } finally {
      isSubmittingRef.current = false;
    }
  }, [activeCandidate, loadCandidates, session]);

  return (
    <section className="page">
      {state.matchFeedback ? (
        <section className="discover-list" aria-live="polite">
          <DiscoverMatchFeedback
            displayName={state.matchFeedback.displayName}
            onDismiss={() => dispatch({ type: 'match_feedback_dismissed' })}
          />
        </section>
      ) : null}

      {!state.matchFeedback && state.loading ? (
        <section className="discover-list" aria-live="polite">
          <DiscoverStatePanel title="Загружаем анкеты" message="Подбираем следующего кандидата." />
        </section>
      ) : null}

      {!state.matchFeedback && state.loadError ? (
        <section className="discover-list" aria-live="polite">
          <DiscoverStatePanel title="Не удалось загрузить анкеты" message="Проверьте подключение и попробуйте ещё раз." error action={
            <button type="button" className="discover-state__action" onClick={() => void loadCandidates()}>
              Повторить
            </button>} />
        </section>
      ) : null}

      {!state.matchFeedback && !state.loading && !state.loadError && activeCandidate ? (
        <section className="discover-list" aria-label="Активная карточка попутчика" hidden={state.decisionError}>
          <BuddyCard
            key={activeCandidate.user_id}
            buddy={toDiscoverCardCandidate(activeCandidate)}
            disabled={state.submitting}
            onDismiss={() => void submitDecision('rejected')}
            onInterested={() => void submitDecision('interested')}
          />
        </section>
      ) : null}

      {!state.matchFeedback && !state.loading && !state.loadError && activeCandidate && state.decisionError ? (
        <DiscoverStatePanel error title="Не удалось отправить решение" message={`${activeCandidate.display_name}${activeCandidate.age === null ? '' : `, ${activeCandidate.age}`} · ${lastDecision === 'interested' ? 'Подходит' : 'Не подходит'}`} action={<button type="button" className="discover-state__action" disabled={state.submitting || lastDecision === null} onClick={() => { if (lastDecision) void submitDecision(lastDecision); }}>Повторить</button>} />
      ) : null}

      {!state.matchFeedback && !state.loading && !state.loadError && !activeCandidate ? (
        <section className="discover-list" aria-label="Новых кандидатов нет">
          <DiscoverStatePanel title="Кандидаты закончились" message="Сейчас новых кандидатов нет." action={<Link className="discover-state__action" href="/chats">К чатам</Link>} />
        </section>
      ) : null}
    </section>
  );
}
