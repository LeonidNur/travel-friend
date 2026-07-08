type ChatStatus = 'match' | 'interest_sent' | 'draft';

type MockChat = {
  id: string;
  buddyName: string;
  age: number;
  city: string;
  destination: string;
  status: ChatStatus;
  previewText: string;
  updatedLabel: string;
};

const STATUS_LABELS: Record<ChatStatus, string> = {
  match: 'Мэтч',
  interest_sent: 'Интерес отправлен',
  draft: 'Черновик обсуждения'
};

const MOCK_CHATS: MockChat[] = [
  {
    id: 'chat-amina-tbilisi',
    buddyName: 'Амина',
    age: 27,
    city: 'Казань',
    destination: 'Тбилиси',
    status: 'match',
    previewText: 'Можно начать с обсуждения дат, района для жилья и общего бюджета на поездку.',
    updatedLabel: 'только что'
  },
  {
    id: 'chat-ilya-istanbul',
    buddyName: 'Илья',
    age: 30,
    city: 'Москва',
    destination: 'Стамбул',
    status: 'interest_sent',
    previewText: 'Пока это заготовка: здесь позже будет удобно договориться о перелёте и планах на выходные.',
    updatedLabel: 'сегодня'
  },
  {
    id: 'chat-sonya-yerevan',
    buddyName: 'Соня',
    age: 25,
    city: 'Ереван',
    destination: 'Будапешт',
    status: 'draft',
    previewText: 'Черновик подсказывает тему для старта: бюджет, темп поездки и интерес к музеям или прогулкам.',
    updatedLabel: 'сегодня'
  },
  {
    id: 'chat-timur-baku',
    buddyName: 'Тимур',
    age: 32,
    city: 'Санкт-Петербург',
    destination: 'Баку',
    status: 'match',
    previewText: 'Есть взаимный интерес. Когда появится backend, здесь можно будет быстро сверить маршрут и даты.',
    updatedLabel: 'вчера'
  }
];

export default function ChatsPage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Чаты поездок</p>
        <h2 className="hero-card__title">Список будущих обсуждений по поездкам</h2>
        <p className="hero-card__copy">
          После мэтчей и отправленных интересов здесь будут собираться обсуждения будущих поездок.
          Сейчас это MVP-заготовка списка, чтобы было понятно, как будет выглядеть вход в общение.
        </p>
      </article>

      <section className="list-stack" aria-label="Список mock-чатов">
        {MOCK_CHATS.map((chat) => (
          <article className="surface-card surface-card--compact chat-card" key={chat.id}>
            <div className="chat-card__header">
              <div>
                <p className="surface-card__title">
                  {chat.buddyName}, {chat.age}
                </p>
                <p className="chat-card__meta">{chat.city}</p>
              </div>
              <span className={`chat-status chat-status--${chat.status}`}>{STATUS_LABELS[chat.status]}</span>
            </div>

            <p className="chat-card__route">Направление: {chat.destination}</p>
            <p className="surface-card__copy">{chat.previewText}</p>

            <div className="chat-card__footer">
              <span className="chat-card__updated">{chat.updatedLabel}</span>
              <span className="chat-card__hint">Реальная переписка появится позже</span>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
