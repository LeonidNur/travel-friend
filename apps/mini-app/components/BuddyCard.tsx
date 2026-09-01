import { getDiscoverLevelLabels, type DiscoverCardCandidate } from '@/lib/discover-runtime';

interface BuddyCardProps {
  buddy: DiscoverCardCandidate;
  onDismiss: () => void;
  onInterested: () => void;
  disabled: boolean;
}

function formatDateRange(dateFrom: string | null, dateTo: string | null): string | null {
  if (dateFrom && dateTo) {
    return `${dateFrom} — ${dateTo}`;
  }

  return dateFrom ?? dateTo;
}

export function BuddyCard({ buddy, onDismiss, onInterested, disabled }: BuddyCardProps) {
  const visibleInterests = buddy.interests.slice(0, 4);
  const visibleTravelStyles = buddy.travelStyle.slice(0, 3);
  const dates = formatDateRange(buddy.travelIntent.dateFrom, buddy.travelIntent.dateTo);
  const levels = getDiscoverLevelLabels(buddy.budgetLevel, buddy.comfortLevel);

  return (
    <article className="surface-card surface-card--compact buddy-card">
      <div className="buddy-card__header">
        <div>
          <h2 className="buddy-card__title">
            {buddy.displayName}{buddy.age === null ? '' : `, ${buddy.age}`}
          </h2>
          {buddy.city ? <p className="buddy-card__city">{buddy.city}</p> : null}
        </div>
        {levels.budget || levels.comfort ? (
          <div className="buddy-card__meta">
            {levels.budget ? <span className="chip buddy-card__budget">{levels.budget}</span> : null}
            {levels.comfort ? <span className="chip">{levels.comfort}</span> : null}
          </div>
        ) : null}
      </div>

      {buddy.bio ? <p className="buddy-card__tagline">{buddy.bio}</p> : null}

      <div className="buddy-card__section">
        <span className="buddy-card__label">Направление</span>
        <div className="chip-row">
          <span className="chip">{buddy.travelIntent.destination}</span>
        </div>
      </div>

      {dates ? (
        <div className="buddy-card__section">
          <span className="buddy-card__label">Даты</span>
          <p className="buddy-card__tagline">{dates}</p>
        </div>
      ) : null}

      {visibleInterests.length > 0 ? <div className="buddy-card__section">
        <span className="buddy-card__label">Интересы</span>
        <div className="chip-row">
          {visibleInterests.map((interest) => (
            <span className="chip" key={interest}>
              {interest}
            </span>
          ))}
        </div>
      </div> : null}

      {visibleTravelStyles.length > 0 ? <div className="buddy-card__section">
        <span className="buddy-card__label">Стиль отдыха</span>
        <div className="chip-row">
          {visibleTravelStyles.map((style) => (
            <span className="chip" key={style}>
              {style}
            </span>
          ))}
        </div>
      </div> : null}

      <div className="buddy-card__footer">
        <div className="buddy-card__actions">
          <button type="button" className="profile-button profile-button--secondary" onClick={onDismiss} disabled={disabled}>
            Не подходит
          </button>
          <button type="button" className="profile-button profile-button--primary" onClick={onInterested} disabled={disabled}>
            Подходит
          </button>
        </div>
      </div>
    </article>
  );
}
