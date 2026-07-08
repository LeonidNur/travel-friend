const profile = {
  name: 'Алина Морозова',
  age: 29,
  city: 'Санкт-Петербург',
  description:
    'Люблю собирать маршруты с понятной логистикой, искать попутчиков с похожим ритмом и оставлять место для спонтанных остановок.',
  avatarInitials: 'АМ',
  interests: ['Горы', 'Городские поездки', 'Бюджетные маршруты', 'Долгие выезды'],
  travelPreferences: [
    { label: 'Желаемые направления', value: 'Тбилиси, Стамбул, Барселона' },
    { label: 'Бюджет', value: 'Средний, без лишнего люкса' },
    { label: 'Даты', value: 'Гибкие, комфортно двигаться в пределах недели' },
    { label: 'Стиль отдыха', value: 'Баланс городских прогулок и коротких выездов' },
    { label: 'Уровень комфорта', value: 'Средний плюс, с нормальным жильем и без хаоса' }
  ],
  trustSignals: [
    { title: 'Telegram connected', note: 'Профиль привязан к Telegram Mini App' },
    { title: 'Verification later', note: 'Подтверждение личности и бейджи появятся в следующих этапах MVP' }
  ]
} as const;

type DetailItem = {
  label: string;
  value: string;
};

type TrustSignal = {
  title: string;
  note: string;
};

function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div className="detail-list__item" key={item.label}>
          <dt className="detail-list__label">{item.label}</dt>
          <dd className="detail-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TrustStack({ items }: { items: readonly TrustSignal[] }) {
  return (
    <div className="trust-stack">
      {items.map((item) => (
        <div className="trust-stack__item" key={item.title}>
          <div className="trust-stack__row">
            <span className="trust-stack__title">{item.title}</span>
            <span className="trust-stack__badge">placeholder</span>
          </div>
          <p className="trust-stack__note">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Профиль</p>
        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {profile.avatarInitials}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">
              {profile.name}, {profile.age}
            </h2>
            <p className="profile-hero__city">{profile.city}</p>
          </div>
        </div>
        <p className="hero-card__copy">{profile.description}</p>
        <div className="chip-row" aria-label="Статус профиля">
          <span className="chip chip--accent">Telegram connected</span>
          <span className="chip">Verification later</span>
        </div>
      </article>

      <section className="card-grid" aria-label="Профиль пользователя">
        <article className="surface-card">
          <p className="surface-card__title">Интересы</p>
          <div className="chip-row" aria-label="Интересы путешествий">
            {profile.interests.map((interest) => (
              <span className="chip" key={interest}>
                {interest}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Travel preferences</p>
          <DetailList items={profile.travelPreferences} />
        </article>

        <article className="surface-card surface-card--wide">
          <p className="surface-card__title">Trust / safety</p>
          <TrustStack items={profile.trustSignals} />
        </article>
      </section>
    </section>
  );
}
