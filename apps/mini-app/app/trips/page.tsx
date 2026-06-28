const trips = [
  {
    title: 'Создано: Баку в июле',
    meta: '2 участника · статус: в поиске',
    note: 'Можно добавить описание маршрута и требования к попутчикам'
  },
  {
    title: 'Будущая поездка: Алматы',
    meta: 'Черновик · даты уточняются',
    note: 'Список участников и детали появятся после публикации'
  },
  {
    title: 'Сохранено: Грузия на осень',
    meta: 'Интересы совпадают · 6 сохранений',
    note: 'Подойдет для быстрого старта новой поездки'
  }
];

export default function TripsPage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Поездки</p>
        <h2 className="hero-card__title">Ваши поездки и заготовки для будущих маршрутов</h2>
        <p className="hero-card__copy">
          Пока здесь placeholder-структура, но уже видно, где будут созданные поездки, черновики и
          сохранённые планы.
        </p>
      </article>

      <section className="list-stack" aria-label="Список поездок">
        {trips.map((trip) => (
          <article className="surface-card surface-card--compact" key={trip.title}>
            <p className="surface-card__title">{trip.title}</p>
            <p className="surface-card__copy">{trip.meta}</p>
            <p className="surface-card__note">{trip.note}</p>
          </article>
        ))}
      </section>
    </section>
  );
}
