'use client';

import { useRouter } from 'next/navigation';

export function ProfileBackButton() {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push('/');
  };

  return (
    <button type="button" className="profile-action profile-action--button profile-back-button" onClick={handleBack}>
      ← Назад
    </button>
  );
}
