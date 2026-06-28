interface AppHeaderProps {
  title: string;
  description: string;
}

export function AppHeader({ title, description }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__eyebrow">Travel Friend</div>
      <div className="app-header__content">
        <h1 className="app-header__title">{title}</h1>
        <p className="app-header__description">{description}</p>
      </div>
    </header>
  );
}
