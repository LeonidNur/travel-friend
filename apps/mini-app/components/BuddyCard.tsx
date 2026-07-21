import Link from 'next/link';

import {
  getBudgetScale,
  getComfortLabel,
  type BuddyMatchSignals
} from '@/lib/mock-buddies';
import type { BuddyProfile } from '@/lib/types';

interface BuddyCardProps {
  buddy: BuddyProfile;
  matchSignals: BuddyMatchSignals;
  onDismiss: () => void;
  onInterested: () => void;
}

function getChipClassName(isMatch: boolean) {
  return isMatch ? 'chip chip--accent' : 'chip';
}

export function BuddyCard({ buddy, matchSignals, onDismiss, onInterested }: BuddyCardProps) {
  const visibleInterests = buddy.interests.slice(0, 4);
  const visibleTravelStyles = buddy.travelStyles.slice(0, 3);

  return (
    <article className="surface-card surface-card--compact buddy-card">
      <div className="buddy-card__header">
        <div>
          <h2 className="buddy-card__title">
            {buddy.name}, {buddy.age}
          </h2>
          <p className="buddy-card__city">{buddy.city}</p>
        </div>
        <div className="buddy-card__meta">
          <span
            className={`${getChipClassName(matchSignals.isBudgetMatch)} buddy-card__budget`}
            aria-label={`Бюджет ${getBudgetScale(buddy.budgetLevel)}`}
          >
            {getBudgetScale(buddy.budgetLevel)}
          </span>
          <span className={getChipClassName(matchSignals.isComfortMatch)}>{getComfortLabel(buddy.comfortLevel)}</span>
        </div>
      </div>

      <p className="buddy-card__tagline">{buddy.tagline}</p>

      <div className="buddy-card__section">
        <span className="buddy-card__label">Направления</span>
        <div className="chip-row">
          {buddy.destinations.map((destination) => (
            <span
              className={getChipClassName(matchSignals.matchedDestinations.includes(destination))}
              key={destination}
            >
              {destination}
            </span>
          ))}
        </div>
      </div>

      <div className="buddy-card__section">
        <span className="buddy-card__label">Интересы</span>
        <div className="chip-row">
          {visibleInterests.map((interest) => (
            <span className={getChipClassName(matchSignals.matchedInterests.includes(interest))} key={interest}>
              {interest}
            </span>
          ))}
        </div>
      </div>

      <div className="buddy-card__section">
        <span className="buddy-card__label">Стиль отдыха</span>
        <div className="chip-row">
          {visibleTravelStyles.map((style) => (
            <span className={getChipClassName(matchSignals.matchedTravelStyles.includes(style))} key={style}>
              {style}
            </span>
          ))}
        </div>
      </div>

      <div className="buddy-card__footer">
        <div className="buddy-card__actions">
          <button type="button" className="profile-button profile-button--secondary" onClick={onDismiss}>
            Не подходит
          </button>
          <button type="button" className="profile-button profile-button--primary" onClick={onInterested}>
            Подходит
          </button>
        </div>

        <Link className="profile-action buddy-card__profile-link" href={`/buddies/${buddy.id}`}>
          Открыть профиль
        </Link>
      </div>
    </article>
  );
}
