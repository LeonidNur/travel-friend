const featuredDirections = ['Стамбул', 'Тбилиси', 'Пхукет', 'Барселона'];
const upcomingTrips = [
  {
    title: 'Москва → Сочи',
    meta: '2 человека ищут попутчиков',
    note: 'Вылет через 9 дней'
  },
  {
    title: 'Казань → Санкт-Петербург',
    meta: 'Готова группа на 4 места',
    note: 'Нужен удобный маршрут'
  }
];

export default function HomePage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Поиск попутчиков</p>
        <h2 className="hero-card__title">Найдите поездку или людей для следующего маршрута</h2>
        <p className="hero-card__copy">
          Смотрите направления, сравнивайте поездки и быстро переходите к чату с будущей
          группой.
        </p>
      </article>

      <section className="card-grid" aria-label="Основные разделы">
        <article className="surface-card">
          <p className="surface-card__title">Найти попутчиков</p>
          <p className="surface-card__copy">
            Быстрый вход в поиск поездок по датам, направлению и интересам.
          </p>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Популярные направления</p>
          <div className="chip-row" aria-label="Популярные направления">
            {featuredDirections.map((direction) => (
              <span className="chip" key={direction}>
                {direction}
              </span>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <p className="surface-card__title">Ближайшие поездки</p>
          <div className="list-stack">
            {upcomingTrips.map((trip) => (
              <div className="list-item" key={trip.title}>
                <div>
                  <h3 className="list-item__title">{trip.title}</h3>
                  <p className="list-item__meta">{trip.meta}</p>
                </div>
                <span className="list-item__note">{trip.note}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
