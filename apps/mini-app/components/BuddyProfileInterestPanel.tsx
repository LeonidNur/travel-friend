'use client';

import { useState } from 'react';

import { InterestOutcomeBanner } from '@/components/InterestOutcomeBanner';
import type { BuddyProfile, InterestDecision } from '@/lib/types';

interface BuddyProfileInterestPanelProps {
  buddy: BuddyProfile;
}

type ProfileInterestState = 'idle' | Exclude<InterestDecision, 'rejected'>;

export function BuddyProfileInterestPanel({ buddy }: BuddyProfileInterestPanelProps) {
  const [interestState, setInterestState] = useState<ProfileInterestState>('idle');

  const handleInterest = () => {
    setInterestState(buddy.likedYou ? 'match' : 'interest-sent');
  };

  if (interestState === 'match') {
    return <InterestOutcomeBanner buddyName={buddy.name} variant="match" />;
  }

  if (interestState === 'interest-sent') {
    return <InterestOutcomeBanner buddyName={buddy.name} variant="interest-sent" />;
  }

  return (
    <article className="surface-card surface-card--compact surface-card--wide interest-panel">
      <div className="interest-panel__content">
        <p className="section-kicker">Mock interest</p>
        <h3 className="interest-panel__title">Если профиль подходит, можно зафиксировать интерес</h3>
        <p className="surface-card__copy">
          Это локальный сценарий MVP без чатов и сохранения на сервере.
        </p>
      </div>
      <button
        type="button"
        className="profile-button profile-button--primary interest-panel__action"
        onClick={handleInterest}
      >
        Подходит
      </button>
    </article>
  );
}
