'use client';

import { BuddyProfileInterestPanel } from '@/components/BuddyProfileInterestPanel';
import { ProfileBackButton } from '@/components/ProfileBackButton';
import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import {
  getBuddyInitials,
  getBuddyMatchSignals,
  getBudgetScale,
  getComfortLabel
} from '@/lib/mock-buddies';
import type { BuddyProfile } from '@/lib/types';

interface BuddyPublicProfileProps {
  buddy: BuddyProfile;
}

type DetailItem = {
  label: string;
  value: string;
  isMatch?: boolean;
};

function getChipClassName(isMatch: boolean) {
  return isMatch ? 'chip chip--accent' : 'chip';
}

function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div className={`detail-list__item${item.isMatch ? ' detail-list__item--match' : ''}`} key={item.label}>
          <dt className="detail-list__label">{item.label}</dt>
          <dd className="detail-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BuddyPublicProfile({ buddy }: BuddyPublicProfileProps) {
  const { profile } = useCurrentUserProfile();
  const matchSignals = getBuddyMatchSignals(buddy, profile);
  const detailItems: DetailItem[] = [
    { label: 'Описание', value: buddy.bio },
    {
      label: 'Бюджет',
      value: `${getBudgetScale(buddy.budgetLevel)} • ${matchSignals.isBudgetMatch ? 'совпадает' : 'не совпадает'}`,
      isMatch: matchSignals.isBudgetMatch
    },
    { label: 'Даты', value: buddy.dates },
    {
      label: 'Уровень комфорта',
      value: `${getComfortLabel(buddy.comfortLevel)} • ${matchSignals.isComfortMatch ? 'совпадает' : 'не совпадает'}`,
      isMatch: matchSignals.isComfortMatch
    }
  ];

  return (
    <section className="page">
      <article className="hero-card">
        <div className="profile-header">
          <ProfileBackButton />
          <span className="profile-status">MVP preview</span>
        </div>
        <p className="section-kicker">Public profile</p>

        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {getBuddyInitials(buddy.name)}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">
              {buddy.name}, {buddy.age}
            </h2>
            <p className="profile-hero__city">{buddy.city}</p>
          </div>
        </div>

        <p className="public-profile__tagline">{buddy.tagline}</p>

        <div className="chip-row" aria-label="Статусы профиля">
          <span className={getChipClassName(matchSignals.isBudgetMatch)}>
            Бюджет {getBudgetScale(buddy.budgetLevel)}
          </span>
          <span className={getChipClassName(matchSignals.isComfortMatch)}>
            {getComfortLabel(buddy.comfortLevel)}
          </span>
        </div>
      </article>

      <section className="card-grid" aria-label="Расширенная информация профиля">
        <article className="surface-card">
          <p className="surface-card__title">Интересы</p>
          <div className="chip-row" aria-label="Интересы попутчика">
            {buddy.interests.map((interest) => (
              <span className={getChipClassName(matchSignals.matchedInterests.includes(interest))} key={interest}>
                {interest}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Направления</p>
          <div className="chip-row" aria-label="Направления попутчика">
            {buddy.destinations.map((destination) => (
              <span
                className={getChipClassName(matchSignals.matchedDestinations.includes(destination))}
                key={destination}
              >
                {destination}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Стиль отдыха</p>
          <div className="chip-row" aria-label="Стили отдыха попутчика">
            {buddy.travelStyles.map((style) => (
              <span className={getChipClassName(matchSignals.matchedTravelStyles.includes(style))} key={style}>
                {style}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Формат поездки</p>
          <DetailList items={detailItems} />
        </article>

        <article className="surface-card surface-card--wide">
          <p className="surface-card__title">Почему может подойти</p>
          <div className="match-stack">
            <p className="match-stack__lead">
              Это демонстрационная рекомендация, а не подтверждённый вывод системы.
            </p>
            <p className="match-stack__copy">{buddy.compatibilityReason}</p>
            {buddy.compatibilityDetails.map((detail) => (
              <div className="match-stack__item" key={detail}>
                <span className="match-stack__dot" aria-hidden="true" />
                <p className="match-stack__copy">{detail}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-card surface-card--wide">
          <p className="surface-card__title">Trust / safety</p>
          <div className="trust-stack">
            {buddy.trustSignals.map((signal) => (
              <div className="trust-stack__item" key={signal.title}>
                <div className="trust-stack__row">
                  <span className="trust-stack__title">{signal.title}</span>
                  <span className="trust-stack__badge">placeholder</span>
                </div>
                <p className="trust-stack__note">{signal.note}</p>
              </div>
            ))}
          </div>
        </article>

        <BuddyProfileInterestPanel buddy={buddy} />
      </section>
    </section>
  );
}
