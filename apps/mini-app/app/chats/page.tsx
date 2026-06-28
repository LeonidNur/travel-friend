const chatGroups = [
  {
    title: 'Тбилиси, апрель',
    meta: '12 участников · 3 активных диалога',
    note: 'Обсуждают перелёт, жильё и общий трансфер'
  },
  {
    title: 'Сочи, майские',
    meta: '8 участников · 2 новых запроса',
    note: 'Удобно сравнивать варианты поездки'
  },
  {
    title: 'Стамбул, выходные',
    meta: '5 участников · чат открыт',
    note: 'AI-помощник будет доступен прямо в чате'
  }
];

export default function ChatsPage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Чаты поездок</p>
        <h2 className="hero-card__title">Группы, где удобно договориться о поездке</h2>
        <p className="hero-card__copy">
          Здесь будут все чаты ваших поездок, а AI-помощник позже появится внутри беседы как
          встроенный инструмент.
        </p>
      </article>

      <section className="list-stack" aria-label="Список чатов">
        {chatGroups.map((chat) => (
          <article className="surface-card surface-card--compact" key={chat.title}>
            <p className="surface-card__title">{chat.title}</p>
            <p className="surface-card__copy">{chat.meta}</p>
            <p className="surface-card__note">{chat.note}</p>
          </article>
        ))}
      </section>
    </section>
  );
}
