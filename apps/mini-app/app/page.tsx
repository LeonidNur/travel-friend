'use client';

import { useState } from 'react';

import { BuddyCard } from '@/components/BuddyCard';
import { getBuddyMatchSignals, mockBuddies } from '@/lib/mock-buddies';

export default function HomePage() {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeBuddy = mockBuddies[activeIndex] ?? null;
  const viewedCount = Math.min(activeIndex, mockBuddies.length);
  const remainingCount = Math.max(mockBuddies.length - viewedCount, 0);

  const handleNextBuddy = () => {
    setActiveIndex((currentIndex) => currentIndex + 1);
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
            <span className="discover-stat__value">MVP</span>
            <span className="discover-stat__label">Без свайпов и match logic</span>
          </div>
        </div>
      </article>

      {activeBuddy ? (
        <section className="discover-list" aria-label="Активная карточка попутчика">
          <BuddyCard
            buddy={activeBuddy}
            matchSignals={getBuddyMatchSignals(activeBuddy)}
            onDismiss={handleNextBuddy}
            onInterested={handleNextBuddy}
          />
        </section>
      ) : (
        <section className="discover-list" aria-label="Состояние конца колоды">
          <article className="surface-card surface-card--compact empty-state-card">
            <p className="section-kicker">Discover complete</p>
            <h2 className="empty-state-card__title">Пока всё. Позже покажем больше попутчиков.</h2>
            <p className="surface-card__copy">
              Вы просмотрели весь текущий mock-набор. Следующая итерация может добавить новые анкеты
              и реальную логику подбора.
            </p>
          </article>
        </section>
      )}
    </section>
  );
}
