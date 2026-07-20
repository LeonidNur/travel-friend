'use client';

import { useInterestDecisions } from '@/components/InterestDecisionProvider';
import { InterestOutcomeBanner } from '@/components/InterestOutcomeBanner';
import { getPositiveInterestDecision } from '@/lib/interest-decisions';
import type { BuddyProfile } from '@/lib/types';

interface BuddyProfileInterestPanelProps {
  buddy: BuddyProfile;
}

export function BuddyProfileInterestPanel({ buddy }: BuddyProfileInterestPanelProps) {
  const { getDecision, setDecision } = useInterestDecisions();
  const interestDecision = getDecision(buddy.id);

  const handleInterest = () => {
    if (interestDecision) {
      return;
    }

    setDecision(buddy.id, getPositiveInterestDecision(buddy));
  };

  if (interestDecision === 'match') {
    return <InterestOutcomeBanner buddyName={buddy.name} variant="match" />;
  }

  if (interestDecision === 'interest-sent') {
    return <InterestOutcomeBanner buddyName={buddy.name} variant="interest-sent" />;
  }

  if (interestDecision === 'rejected') {
    return (
      <article className="surface-card surface-card--compact surface-card--wide interest-panel">
        <div className="interest-panel__content">
          <p className="section-kicker">Mock interest</p>
          <h3 className="interest-panel__title">Вы решили, что этот профиль не подходит</h3>
          <p className="surface-card__copy">Решение уже зафиксировано для текущей сессии.</p>
        </div>
      </article>
    );
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
