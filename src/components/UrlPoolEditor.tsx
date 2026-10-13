import { useMemo } from 'react';
import { parseUrlPool } from '../shared/urlPool';

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function UrlPoolEditor({ value, onChange, disabled = false }: Props) {
  const parsed = useMemo(() => parseUrlPool(value), [value]);
  return (
    <div className="url-pool-editor">
      <label className="field field--full">
        <span>Target URL Pool</span>
        <textarea
          aria-label="Target URL Pool"
          rows={9}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={'unknown-url.example\nexample.com/blog\nhttps://example.org/tool'}
          spellCheck={false}
        />
        <small>One URL per line. Large lists are validated and assigned from a shuffled deck without repeated target cards.</small>
      </label>
      <div className="url-pool-stats" aria-label="URL pool validation summary">
        <span><strong>Valid URLs: {parsed.valid.length}</strong></span>
        <span>Duplicates removed: {parsed.duplicates}</span>
        <span className={parsed.invalid.length ? 'url-pool-stat--warning' : ''}>Invalid: {parsed.invalid.length}</span>
      </div>
      {parsed.invalid.length > 0 && (
        <details className="url-pool-invalid">
          <summary>Show invalid entries</summary>
          <div>
            {parsed.invalid.slice(0, 50).map((item) => (
              <p key={`${item.line}-${item.input}`}><strong>Line {item.line}</strong> {item.input} <small>{item.reason}</small></p>
            ))}
            {parsed.invalid.length > 50 && <p><small>{parsed.invalid.length - 50} more invalid entries are hidden from this preview.</small></p>}
          </div>
        </details>
      )}
    </div>
  );
}
