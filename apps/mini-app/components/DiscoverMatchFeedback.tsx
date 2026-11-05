import Link from 'next/link';

interface DiscoverMatchFeedbackProps {
  displayName: string;
  onDismiss?: () => void;
}

export function DiscoverMatchFeedback({ displayName, onDismiss }: DiscoverMatchFeedbackProps) {
  return (
    <article className="surface-card surface-card--compact">
      <p className="surface-card__copy">У вас мэтч с {displayName}. Можно начать общение.</p>
      <Link className="profile-button profile-button--primary" href="/chats">
        Открыть чаты
      </Link>
      {onDismiss ? (
        <button
          type="button"
          className="profile-button profile-button--secondary"
          onClick={onDismiss}
        >
          Закрыть
        </button>
      ) : null}
    </article>
  );
}
