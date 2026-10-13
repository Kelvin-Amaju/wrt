type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: 'violet' | 'cyan' | 'green' | 'amber';
};

export function MetricCard({ label, value, hint, tone = 'violet' }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__topline">
        <span>{label}</span>
        <span className="metric-card__dot" />
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}
