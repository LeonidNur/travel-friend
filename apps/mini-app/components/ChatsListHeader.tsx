export function ChatsListHeader({ onCreate }: Readonly<{ onCreate?: () => void }>) {
  return (
    <header className="hero-card screen-heading">
      <h1 className="hero-card__title">Чаты</h1>
      {onCreate ? (
        <>
          <p className="hero-card__copy">Обсуждения с будущими попутчиками</p>
          <button className="profile-button profile-button--secondary" type="button" onClick={onCreate}>
            Создать групповой чат
          </button>
        </>
      ) : null}
    </header>
  );
}
