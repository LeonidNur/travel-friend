import Link from 'next/link';

export function ChatsScreenStatus({ state, onRetry }: Readonly<{ state: 'loading' | 'error' | 'empty'; onRetry: () => void }>) {
  if (state === 'loading') return (
    <article className="chat-screen-status" role="status">
      <h2>Загружаем чаты</h2>
      <p>Получаем список доступных разговоров.</p>
    </article>
  );
  if (state === 'error') return (
    <article className="chat-screen-status chat-screen-status--error" role="alert">
      <h2>Не удалось загрузить чаты</h2>
      <p>Попробуйте загрузить список ещё раз.</p>
      <button className="profile-button profile-button--primary" type="button" onClick={onRetry}>Повторить</button>
    </article>
  );
  return (
    <article className="chat-screen-status">
      <h2>Чатов пока нет</h2>
      <p>Здесь появятся ваши обсуждения</p>
      <Link className="profile-button profile-button--primary" href="/">Перейти к анкетам</Link>
    </article>
  );
}
