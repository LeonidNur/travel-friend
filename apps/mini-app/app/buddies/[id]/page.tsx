import Link from 'next/link';

import { BuddyPublicProfile } from '@/components/BuddyPublicProfile';
import { getBuddyById } from '@/lib/mock-buddies';

interface BuddyProfilePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BuddyProfilePage({ params }: BuddyProfilePageProps) {
  const { id } = await params;
  const buddy = getBuddyById(id);

  if (!buddy) {
    return (
      <section className="page">
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Профиль не найден</p>
          <h2 className="empty-state-card__title">Публичный профиль не найден</h2>
          <p className="surface-card__copy">
            Возможно, анкета была удалена или её нет в текущем наборе демонстрационных профилей.
          </p>
          <Link className="profile-button profile-button--secondary buddy-card__profile-link" href="/">
            Вернуться к просмотру
          </Link>
        </article>
      </section>
    );
  }

  return <BuddyPublicProfile buddy={buddy} />;
}
