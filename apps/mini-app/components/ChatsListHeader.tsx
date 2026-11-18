export function ChatsListHeader({ disabled, onCreate }: Readonly<{ disabled?: boolean; onCreate: () => void }>) {
  return <article className="hero-card screen-heading"><h1 className="hero-card__title">Чаты</h1><p className="hero-card__copy">Обсуждения с будущими попутчиками</p><button className="profile-button profile-button--secondary" type="button" disabled={disabled} onClick={onCreate}>Создать групповой чат</button></article>;
}
