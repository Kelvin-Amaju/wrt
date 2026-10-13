type TopbarProps = { title: string };

export function Topbar({ title }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <span className="topbar__eyebrow">WORKSPACE</span>
        <h1>{title}</h1>
      </div>
      <div className="topbar__actions">
        <span className="status-pill"><i /> LOCAL MODE</span>
        <button className="icon-button" type="button" aria-label="Notifications">•••</button>
      </div>
    </header>
  );
}
