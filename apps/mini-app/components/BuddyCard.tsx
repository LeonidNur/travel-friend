'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { fromCanonicalProfileLevel } from '@/lib/travel-preferences';
import type { DiscoverCardCandidate } from '@/lib/discover-runtime';
import { formatRussianDateRange } from '@/lib/russian-date-format';
import { ParticipantBuddyCard } from '@/components/ParticipantBuddyCard';

interface BuddyCardProps {
  buddy: DiscoverCardCandidate;
  onDismiss?: () => void;
  onInterested?: () => void;
  disabled?: boolean;
  initialExpanded?: boolean;
  ownPreferences?: Readonly<{
    destinations?: readonly string[];
    interests?: readonly (string | null)[];
    travelStyle?: readonly (string | null)[];
  }>;
}

export function BuddyCard({ buddy, onDismiss, onInterested, disabled, initialExpanded = false, ownPreferences }: BuddyCardProps) {
  if (!onDismiss || !onInterested) return <ParticipantBuddyCard buddy={buddy} />;
  return <DiscoverBuddyCard buddy={buddy} onDismiss={onDismiss} onInterested={onInterested} disabled={disabled} initialExpanded={initialExpanded} ownPreferences={ownPreferences} />;
}

function DiscoverBuddyCard({ buddy, onDismiss, onInterested, disabled, initialExpanded = false, ownPreferences }: BuddyCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const contentRef = useRef<HTMLDivElement>(null);
  const dates = formatRussianDateRange(buddy.travelIntent.dateFrom, buddy.travelIntent.dateTo);
  const budget = fromCanonicalProfileLevel(buddy.budgetLevel);
  const comfort = fromCanonicalProfileLevel(buddy.comfortLevel);
  return (
    <div className="discover-only"><article className={`surface-card buddy-card${expanded ? ' buddy-card--expanded' : ''}`}>
      <div ref={contentRef} className="buddy-card__scroll">
        <div className="buddy-card__header">
          <div className="buddy-card__portrait">
            <Image className="buddy-card__photo" src="/figma-assets/profile-placeholder.png" width={740} height={740} alt="" aria-hidden="true" />
            <button type="button" className="buddy-card__expand" aria-expanded={expanded} aria-label={expanded ? 'Свернуть анкету' : 'Раскрыть анкету'} onClick={() => { if (contentRef.current) contentRef.current.scrollTop = 0; setExpanded(!expanded); }}>
              <Image src="/figma-assets/discover-expand.svg" width={24} height={24} alt="" aria-hidden="true" />
            </button>
            {!expanded ? <div className="buddy-card__identity"><h2 className="buddy-card__title">{buddy.displayName}{buddy.age === null ? '' : `, ${buddy.age}`}</h2>{buddy.city ? <p className="buddy-card__city">{buddy.city}</p> : null}</div> : null}
          </div>
          {expanded ? <div className="buddy-card__expanded-identity"><h2 className="buddy-card__title">{buddy.displayName}{buddy.age === null ? '' : `, ${buddy.age}`}</h2>{buddy.city ? <p className="buddy-card__city">{buddy.city}</p> : null}<Level label="Комфорт" level={comfort} icon="/figma-assets/comfort-low.svg" /><Level label="Бюджет" level={budget} icon="/figma-assets/budget-low.svg" /></div> : null}
        </div>
        <div className="buddy-card__details">
          <Section title="Направления" values={[buddy.travelIntent.destination]} ownValues={ownPreferences?.destinations} />
          {expanded && dates ? <div className="buddy-card__section"><span className="buddy-card__label">Даты</span><p className="buddy-card__tagline">{dates}</p></div> : null}
          <Section title="Интересы" values={expanded ? buddy.interests : buddy.interests.slice(0, 4)} ownValues={ownPreferences?.interests} />
          <Section title="Стиль отдыха" values={expanded ? buddy.travelStyle : buddy.travelStyle.slice(0, 3)} ownValues={ownPreferences?.travelStyle} />
          {expanded && buddy.bio ? <div className="buddy-card__section"><span className="buddy-card__label">Комментарий</span><p className="buddy-card__tagline">{buddy.bio}</p></div> : null}
        </div>
      </div>
      {onDismiss && onInterested ? <div className="buddy-card__actions">
        <button type="button" onClick={onDismiss} disabled={disabled} aria-label="Не подходит"><Image src="/figma-assets/discover-dislike.svg" width={32} height={32} alt="" /></button>
        <button type="button" onClick={onInterested} disabled={disabled} aria-label="Подходит"><Image src="/figma-assets/discover-like.svg" width={32} height={32} alt="" /></button>
      </div> : null}
    </article></div>
  );
}

function Section({ title, values, ownValues }: Readonly<{
  title: string;
  values: readonly string[];
  ownValues?: readonly (string | null)[];
}>) {
  if (values.length === 0) return null;
  const normalize = (value: string) => value.trim().normalize().toLocaleLowerCase('ru-RU');
  const own = ownValues?.map((item) => item === null ? null : normalize(item));
  return <div className="buddy-card__section">
    <span className="buddy-card__label">{title}</span>
    <div className="chip-row">{values.map((value) => {
      const matches = own?.includes(normalize(value));
      return <span className="chip" data-match={matches} key={value}>
        {value}{matches !== undefined ? <span className="sr-only">{matches ? ', совпадает с вашим выбором' : ', отличается от вашего выбора'}</span> : null}
      </span>;
    })}</div>
  </div>;
}

function Level({ label, level, icon }: Readonly<{ label: string; level: number | null; icon: string }>) {
  if (level === null) return null;
  return <div className="buddy-card__level" aria-label={`${label}: ${level} из 4`}><span>{label}:</span><span className="buddy-card__level-icons">{Array.from({ length: level }, (_, i) => <Image key={i} src={icon} width={24} height={24} alt="" />)}</span></div>;
}
