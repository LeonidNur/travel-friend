'use client';

import { useState } from 'react';

import { BuddyCard } from '@/components/BuddyCard';
import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { DiscoverSelectedList } from '@/components/DiscoverSelectedList';
import { useInterestDecisions } from '@/components/InterestDecisionProvider';
import { InterestOutcomeBanner } from '@/components/InterestOutcomeBanner';
import {
  getPositiveInterestDecision,
  getRemainingDiscoverCandidates,
  getSelectedDiscoverBuddies,
  getViewedDiscoverCount,
  type PositiveInterestDecision
} from '@/lib/interest-decisions';
import { getBuddyMatchSignals, getDiscoverCandidates } from '@/lib/mock-buddies';
import type { BuddyProfile } from '@/lib/types';

type DiscoverOutcome = {
  buddy: BuddyProfile;
  decision: PositiveInterestDecision;
} | null;

const discoverCandidates = getDiscoverCandidates();

export default function HomePage() {
  const { profile } = useCurrentUserProfile();
  const { decisions, setDecision } = useInterestDecisions();
  const [outcome, setOutcome] = useState<DiscoverOutcome>(null);

  const remainingCandidates = getRemainingDiscoverCandidates(discoverCandidates, decisions);
  const activeBuddy = remainingCandidates[0] ?? null;
  const viewedCount = getViewedDiscoverCount(discoverCandidates, decisions);
  const remainingCount = remainingCandidates.length;
  const selectedBuddies = getSelectedDiscoverBuddies(discoverCandidates, decisions);

  const handleRejected = (buddy: BuddyProfile) => {
    setDecision(buddy.id, 'rejected');
    setOutcome(null);
  };

  const handleInterested = (buddy: BuddyProfile) => {
    const decision = getPositiveInterestDecision(buddy);

    setDecision(buddy.id, decision);
    setOutcome({ buddy, decision });
  };

  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Демо-режим</p>
        <h2 className="hero-card__title">Смотрите по одной анкете и быстро решайте, хотите ли открыть профиль</h2>
        <p className="hero-card__copy">
          На карточке видно только базовые характеристики. После нажатия на кнопку решения
          откроется следующая демонстрационная анкета. Выбор сохраняется только в текущем сеансе
          и не отправляется другому пользователю.
        </p>
        <div className="discover-hero__stats" aria-label="Статистика discovery">
          <div className="discover-stat">
            <span className="discover-stat__value">{remainingCount}</span>
            <span className="discover-stat__label">Осталось анкет</span>
          </div>
          <div className="discover-stat">
            <span className="discover-stat__value">{viewedCount}</span>
            <span className="discover-stat__label">Просмотрено</span>
          </div>
          <div className="discover-stat">
            <span className="discover-stat__value">{selectedBuddies.length}</span>
            <span className="discover-stat__label">Локально отмечено “Подходит”</span>
          </div>
        </div>
      </article>

      {outcome ? (
        <InterestOutcomeBanner
          buddyName={outcome.buddy.name}
          variant={outcome.decision}
        />
      ) : null}

      {activeBuddy ? (
        <section className="discover-list" aria-label="Активная карточка попутчика">
          <BuddyCard
            buddy={activeBuddy}
            matchSignals={getBuddyMatchSignals(activeBuddy, profile)}
            onDismiss={() => handleRejected(activeBuddy)}
            onInterested={() => handleInterested(activeBuddy)}
          />
        </section>
      ) : (
        <section className="discover-list" aria-label="Состояние конца колоды">
          <DiscoverSelectedList selections={selectedBuddies} />
        </section>
      )}
    </section>
  );
}
