'use client';

import { useState } from 'react';

import { BuddyCard } from '@/components/BuddyCard';
import { DiscoverSelectedList } from '@/components/DiscoverSelectedList';
import { InterestOutcomeBanner } from '@/components/InterestOutcomeBanner';
import { getBuddyMatchSignals, mockBuddies } from '@/lib/mock-buddies';
import type { BuddyProfile, InterestDecision } from '@/lib/types';

type MatchState = {
  buddy: BuddyProfile;
} | null;

function getInterestDecision(buddy: BuddyProfile): Exclude<InterestDecision, 'rejected'> {
  return buddy.likedYou ? 'match' : 'interest-sent';
}

export default function HomePage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [interestedIds, setInterestedIds] = useState<string[]>([]);
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [matchState, setMatchState] = useState<MatchState>(null);

  const activeBuddy = mockBuddies[activeIndex] ?? null;
  const viewedCount = interestedIds.length + rejectedIds.length;
  const remainingCount = Math.max(mockBuddies.length - viewedCount, 0);
  const interestedBuddies = mockBuddies.filter((buddy) => interestedIds.includes(buddy.id));

  const handleNextBuddy = () => {
    setActiveIndex((currentIndex) => currentIndex + 1);
  };

  const handleRejected = (buddy: BuddyProfile) => {
    setRejectedIds((currentRejectedIds) =>
      currentRejectedIds.includes(buddy.id) ? currentRejectedIds : [...currentRejectedIds, buddy.id]
    );
    setInterestedIds((currentInterestedIds) =>
      currentInterestedIds.filter((currentBuddyId) => currentBuddyId !== buddy.id)
    );
    setMatchState(null);
    handleNextBuddy();
  };

  const handleInterested = (buddy: BuddyProfile) => {
    setInterestedIds((currentInterestedIds) =>
      currentInterestedIds.includes(buddy.id) ? currentInterestedIds : [...currentInterestedIds, buddy.id]
    );
    setRejectedIds((currentRejectedIds) =>
      currentRejectedIds.filter((currentBuddyId) => currentBuddyId !== buddy.id)
    );
    setMatchState({ buddy });
    handleNextBuddy();
  };

  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Discover MVP</p>
        <h2 className="hero-card__title">Смотрите по одной анкете и быстро решайте, хотите ли открыть профиль</h2>
        <p className="hero-card__copy">
          На карточке видно только базовые характеристики. После нажатия на кнопку решения
          откроется следующая анкета из mock-набора.
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
            <span className="discover-stat__value">{interestedIds.length}</span>
            <span className="discover-stat__label">Локально отмечено “Подходит”</span>
          </div>
        </div>
      </article>

      {matchState ? (
        <InterestOutcomeBanner
          buddyName={matchState.buddy.name}
          variant={getInterestDecision(matchState.buddy)}
        />
      ) : null}

      {activeBuddy ? (
        <section className="discover-list" aria-label="Активная карточка попутчика">
          <BuddyCard
            buddy={activeBuddy}
            matchSignals={getBuddyMatchSignals(activeBuddy)}
            onDismiss={() => handleRejected(activeBuddy)}
            onInterested={() => handleInterested(activeBuddy)}
          />
        </section>
      ) : (
        <section className="discover-list" aria-label="Состояние конца колоды">
          <DiscoverSelectedList buddies={interestedBuddies} />
        </section>
      )}
    </section>
  );
}
