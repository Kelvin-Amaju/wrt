import { useState } from 'react';

export function Pods() {
  const [podName, setPodName] = useState('');
  const [deviceType, setDeviceType] = useState('desktop');
  const [count, setCount] = useState(20);
  const [country, setCountry] = useState('US');
  const [pods, setPods] = useState<any[]>([]);

  const createPod = () => {
    const pod = {
      id: Date.now().toString(),
      name: podName || `Pod-${Date.now()}`,
      deviceType,
      count,
      country,
      profiles: Array.from({ length: count }, (_, i) => ({
        id: `${Date.now()}-${i}`,
        device: deviceType,
        country,
        createdAt: new Date().toISOString()
      }))
    };
    setPods([...pods, pod]);
    setPodName('');
  };

  return (
    <div className="dashboard-page">
      <section className="hero">
        <div>
          <span className="section-kicker">PODS</span>
          <h2>Instant YouTube pods (without Gmail)</h2>
          <p>Create pods with random device profiles assigned to countries for YouTube without Gmail sessions.</p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">
          <div>
            <span className="section-kicker">CREATE POD</span>
            <h3>New pod configuration</h3>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end', padding: 16 }}>
          <label className="field">
            <span>Pod name</span>
            <input type="text" value={podName} onChange={(e) => setPodName(e.target.value)} placeholder="e.g. YouTube-Pod-1" />
          </label>
          <label className="field">
            <span>Device type</span>
            <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
              <option value="desktop">Desktop</option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </select>
          </label>
          <label className="field">
            <span>How many (per device)</span>
            <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="US">US</option>
              <option value="GB">GB</option>
              <option value="CA">CA</option>
              <option value="AU">AU</option>
              <option value="NG">NG</option>
              <option value="IN">IN</option>
            </select>
          </label>
          <button className="primary-button" type="button" onClick={createPod}>Create Pod</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <span className="section-kicker">POD LIST</span>
            <h3>Created pods</h3>
          </div>
        </div>
        {pods.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-secondary)' }}>No pods created yet.</div>
        ) : (
          <div style={{ padding: 16 }}>
            {pods.map((pod) => (
              <div key={pod.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{pod.name}</strong>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pod.deviceType} • {pod.count} profiles • {pod.country}</div>
                  </div>
                  <span className="status-pill status-pill--soft"><i /> {pod.profiles.length} PROFILES</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
