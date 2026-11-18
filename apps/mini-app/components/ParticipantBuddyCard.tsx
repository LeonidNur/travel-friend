import Link from 'next/link';
import Image from 'next/image';

import { getDiscoverLevelLabels, type DiscoverCardCandidate } from '@/lib/discover-runtime';
import { formatRussianDateRange } from '@/lib/russian-date-format';

interface BuddyCardProps {
  buddy: DiscoverCardCandidate;
  onDismiss?: () => void;
  onInterested?: () => void;
  profileHref?: string;
  disabled?: boolean;
}

export function ParticipantBuddyCard({ buddy, onDismiss, onInterested, profileHref, disabled }: BuddyCardProps) {
  const visibleInterests = buddy.interests.slice(0, 4);
  const visibleTravelStyles = buddy.travelStyle.slice(0, 3);
  const dates = formatRussianDateRange(buddy.travelIntent.dateFrom, buddy.travelIntent.dateTo);
  const levels = getDiscoverLevelLabels(buddy.budgetLevel, buddy.comfortLevel);
  // TODO(design-handoff): Discover API has no per-chip match metadata for the Figma match/no-match fills.

  return (
    <article className="surface-card surface-card--compact buddy-card">
      <div className="buddy-card__portrait">
        <Image
          className="buddy-card__photo"
          src="/figma-assets/profile-placeholder.png"
          width={740}
          height={740}
          alt=""
          aria-hidden="true"
        />
        {profileHref ? (
          <Link className="buddy-card__expand" href={profileHref} aria-label={`Открыть профиль: ${buddy.displayName}`}>
            <Image src="/figma-assets/discover-expand.svg" width={24} height={24} alt="" aria-hidden="true" />
          </Link>
        ) : null}
        <div className="buddy-card__identity">
          <h2 className="buddy-card__title">
            {buddy.displayName}{buddy.age === null ? '' : `, ${buddy.age}`}
          </h2>
          {buddy.city ? <p className="buddy-card__city">{buddy.city}</p> : null}
        </div>
      </div>

      {!profileHref && (levels.budget || levels.comfort) ? (
        <div className="buddy-card__meta" aria-label="Предпочтения в поездках">
          {levels.budget ? <span className="chip buddy-card__budget">{levels.budget}</span> : null}
          {levels.comfort ? <span className="chip">{levels.comfort}</span> : null}
        </div>
      ) : null}

      {!profileHref && buddy.bio ? <p className="buddy-card__tagline">{buddy.bio}</p> : null}

      <div className="buddy-card__section">
        <span className="buddy-card__label">Направления</span>
        <div className="chip-row">
          <span className="chip">{buddy.travelIntent.destination}</span>
        </div>
      </div>

      {!profileHref && dates ? (
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

      {onDismiss && onInterested ? <div className="buddy-card__footer">
        <div className="buddy-card__actions">
          <button type="button" className="profile-button profile-button--secondary" onClick={onDismiss} disabled={disabled}>
            <Image src="/figma-assets/discover-dislike.svg" width={32} height={32} alt="" aria-hidden="true" />
            <span className="sr-only">Не подходит</span>
          </button>
          <button type="button" className="profile-button profile-button--primary" onClick={onInterested} disabled={disabled}>
            <Image src="/figma-assets/discover-like.svg" width={32} height={32} alt="" aria-hidden="true" />
            <span className="sr-only">Подходит</span>
          </button>
        </div>
      </div> : null}
    </article>
  );
}
