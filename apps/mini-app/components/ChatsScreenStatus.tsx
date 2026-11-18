import Link from 'next/link';

export function ChatsScreenStatus({ state, error, onRetry }: Readonly<{ state: 'loading' | 'error' | 'empty'; error?: string | null; onRetry: () => void }>) {
  if (state === 'loading') return <article className="surface-card surface-card--compact empty-state-card" aria-live="polite"><p className="section-kicker">Загружаем чаты</p></article>;
  if (state === 'error') return <article className="surface-card surface-card--compact empty-state-card" role="alert"><p className="section-kicker">Не удалось загрузить чаты</p><p className="surface-card__copy">{error}</p><button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button></article>;
  return <article className="surface-card surface-card--compact empty-state-card"><p className="section-kicker">Чатов пока нет</p><h2 className="empty-state-card__title">Здесь появятся ваши обсуждения</h2><Link className="profile-button profile-button--primary" href="/">Перейти к анкетам</Link></article>;
}
