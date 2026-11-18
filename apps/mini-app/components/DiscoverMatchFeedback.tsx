import Link from 'next/link';

interface DiscoverMatchFeedbackProps {
  displayName: string;
  onDismiss?: () => void;
  chatId?: string;
}

export function DiscoverMatchFeedback({ displayName, onDismiss, chatId }: DiscoverMatchFeedbackProps) {
  if (!onDismiss) {
    return <article className="surface-card surface-card--compact"><p className="surface-card__copy">У вас мэтч с {displayName}. Можно начать общение.</p><Link className="profile-button profile-button--primary" href="/chats">Открыть чаты</Link></article>;
  }
  return (
    <article className="discover-match">
      <div className="discover-state"><h2>Вы понравились друг другу</h2>
      <p>Вы и {displayName} проявили взаимный интерес. Можно перейти к общению.</p>
      <Link className="discover-state__action" href={chatId ? `/chats/${chatId}` : '/chats'}>
        {chatId ? 'Открыть чат' : 'Открыть чаты'}
      </Link>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="discover-match__continue"
          onClick={onDismiss}
        >
          Продолжить просмотр
        </button>
      ) : null}
    </article>
  );
}
