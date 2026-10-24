import { useState } from 'react';

export function Warmer() {
  const [topics, setTopics] = useState<string[]>(['investments']);
  const [newTopic, setNewTopic] = useState('');
  const [running, setRunning] = useState(false);

  const addTopic = () => {
    if (newTopic.trim()) {
      setTopics([...topics, newTopic.trim()]);
      setNewTopic('');
    }
  };

  const removeTopic = (idx: number) => {
    setTopics(topics.filter((_, i) => i !== idx));
  };

  const runWarmup = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 2000);
  };

  return (
    <div className="dashboard-page">
      <section className="hero">
        <div>
          <span className="section-kicker">WARMER</span>
          <h2>Profile warmer</h2>
          <p>List topics, warm profiles by visiting Google and searching random things. Saves cookies and history per profile.</p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">
          <div>
            <span className="section-kicker">TOPICS</span>
            <h3>Search topics to warm profiles</h3>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="text" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Add topic (e.g. investments, finance)" style={{ flex: 1 }} />
            <button className="secondary-button" type="button" onClick={addTopic}>Add Topic</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {topics.map((topic, idx) => (
              <span key={idx} style={{ padding: '4px 10px', background: 'var(--panel-alt)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                {topic}
                <button type="button" onClick={() => removeTopic(idx)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">
          <div>
            <span className="section-kicker">RUN WARMER</span>
            <h3>Execute warming</h3>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Profiles visit Google, search random things from topics, save cookies and history in each profile. Use with POD profiles. If visiting a website, use from history. On YouTube select POD profile and target videos.
          </p>
          <button className="primary-button" type="button" onClick={runWarmup} disabled={running}>
            {running ? 'Running...' : 'RUN - Warm with POD profiles'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <span className="section-kicker">GMAIL / ACCOUNT ASSIGNMENT</span>
            <h3>Assign Gmail accounts</h3>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <label className="field">
              <span>Gmail account</span>
              <input type="email" placeholder="account@gmail.com" />
            </label>
            <label className="field">
              <span>Purpose</span>
              <input type="text" placeholder="e.g. YouTube warmup" />
            </label>
            <button className="secondary-button" type="button">Assign</button>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 13 }}>
            Account profiles store authorized sessions. Auto-login will fill appropriate information. Saved accounts remain logged in (not logged out).
          </p>
        </div>
      </section>
    </div>
  );
}
