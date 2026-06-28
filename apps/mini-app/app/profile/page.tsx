import { ProfileDiagnostics } from '@/components/ProfileDiagnostics';

const interests = ['Горы', 'Городские поездки', 'Бюджетные маршруты', 'Долгие выезды'];

export default function ProfilePage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Профиль</p>
        <h2 className="hero-card__title">Базовая карточка пользователя и интересов</h2>
        <p className="hero-card__copy">
          Здесь позже появятся настройки профиля, статус путешествий и более детальная анкета.
        </p>
      </article>

      <section className="card-grid" aria-label="Профиль пользователя">
        <ProfileDiagnostics />

        <article className="surface-card">
          <p className="surface-card__title">Пользователь</p>
          <p className="surface-card__copy">Имя, город, язык общения и краткое описание профиля.</p>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Интересы путешествий</p>
          <div className="chip-row" aria-label="Интересы путешествий">
            {interests.map((interest) => (
              <span className="chip" key={interest}>
                {interest}
              </span>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
