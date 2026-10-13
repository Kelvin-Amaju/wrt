type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <section className="placeholder-page">
      <span className="section-kicker">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="placeholder-card">
        <div className="placeholder-card__glow" />
        <strong>Module foundation ready</strong>
        <span>We will build this module after the desktop shell is running correctly on your PC.</span>
      </div>
    </section>
  );
}
