const cards = [
  {
    title: 'Profile',
    description: 'Show your travel style, languages, and destination preferences.',
    items: ['Bio', 'Languages', 'Travel style']
  },
  {
    title: 'Trips',
    description: 'Create and discover trips with clear dates, routes, and interests.',
    items: ['Create trip', 'Browse trips', 'Join requests']
  },
  {
    title: 'AI Helper',
    description: 'Plan routes, estimate costs, and get quick travel recommendations.',
    items: ['Routes', 'Logistics', 'Prices']
  }
] as const;

export default function HomePage() {
  return (
    <main className="home-screen">
      <section className="hero-card">
        <div className="hero-badge">Telegram Mini App MVP</div>
        <h1>Travel Friend</h1>
        <p className="hero-copy">
          Find people for your next trip, keep plans organized, and get quick help with travel
          decisions.
        </p>

        <div className="hero-stats" aria-label="Project highlights">
          <div>
            <strong>3</strong>
            <span>core modules</span>
          </div>
          <div>
            <strong>Mobile</strong>
            <span>first layout</span>
          </div>
          <div>
            <strong>Ready</strong>
            <span>for MVP work</span>
          </div>
        </div>
      </section>

      <section className="feature-grid" aria-label="Mini app sections">
        {cards.map((card) => (
          <article className="feature-card" key={card.title}>
            <p className="feature-kicker">{card.title}</p>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <ul>
              {card.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
