'use client';

import type { FormEvent } from 'react';
import type { GroupChatCompanion } from '@/lib/group-chat-runtime';
import { getAvatarInitials } from '@/lib/travel-preferences';

export function GroupChatForm({ companions, selectedIds, title, error, isCreating, canRetry, onTitleChange, onToggle, onSubmit, onBack }: Readonly<{
  companions: readonly GroupChatCompanion[]; selectedIds: readonly string[]; title: string; error: string | null;
  isCreating: boolean; canRetry: boolean; onTitleChange: (value: string) => void; onToggle: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onBack: () => void;
}>) {
  return <section className="page group-create-screen">
    <h1>Создать групповой чат</h1><p>Выберите минимум двух собеседников из прямых чатов</p>
    {companions.length === 0 ? <article className="group-create-screen__notice"><h2>Нет доступных собеседников</h2><p>Нет доступных собеседников из прямых чатов.</p></article> : <form className="group-create-screen__form" onSubmit={onSubmit}>
      <div className="group-create-screen__options">{companions.map((companion) => {
        const selected = selectedIds.includes(companion.user_id);
        return <label className="group-create-screen__option" data-selected={selected} key={companion.user_id}>
          <input type="checkbox" checked={selected} disabled={isCreating} onChange={() => onToggle(companion.user_id)} />
          <span className="group-create-screen__avatar" aria-hidden="true">{selected ? '✓' : getAvatarInitials(companion.display_name)}</span>
          <span className="group-create-screen__identity">
            <span className="group-create-screen__name">{companion.display_name}</span>
            <span className="group-create-screen__meta">{companion.age ?? 'Возраст не указан'} · {companion.city ?? 'Город не указан'}</span>
          </span>
        </label>;
      })}</div>
      {error ? <article className="group-create-screen__notice group-create-screen__notice--error" role="alert"><h2>{canRetry ? 'Не удалось создать чат' : 'Проверьте выбор'}</h2><p>{error}</p></article> : null}
      <button className="group-create-screen__submit" disabled={isCreating} type="submit">{isCreating ? 'Создаём…' : canRetry ? 'Повторить создание' : 'Создать чат'}</button>
      <details className="group-create-screen__optional">
        <summary>{title.trim() ? 'Изменить название группы' : 'Добавить название группы'}</summary>
        <label className="group-create-screen__title"><span>Название группы (необязательно)</span><input autoComplete="off" disabled={isCreating} value={title} onChange={(event) => onTitleChange(event.target.value)} /></label>
      </details>
    </form>}
    <button type="button" className="group-create-screen__back" onClick={onBack} disabled={isCreating}>← К чатам</button>
  </section>;
}
