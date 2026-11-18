import Link from 'next/link';

interface DiscoverMatchFeedbackProps {
  displayName: string;
  onDismiss?: () => void;
}

export function DiscoverMatchFeedback({ displayName, onDismiss }: DiscoverMatchFeedbackProps) {
  if (!onDismiss) {
    return <article className="surface-card surface-card--compact"><p className="surface-card__copy">У вас мэтч с {displayName}. Можно начать общение.</p><Link className="profile-button profile-button--primary" href="/chats">Открыть чаты</Link></article>;
  }
  return (
    <article className="discover-match">
      <div className="discover-state"><h2>Вы понравились друг другу</h2>
      <p>Вы и {displayName} проявили взаимный интерес. Можно перейти к общению.</p>
      <Link className="discover-state__action" href="/chats">
        Открыть чат
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
