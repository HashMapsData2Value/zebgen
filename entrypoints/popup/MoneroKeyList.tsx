import { useEffect, useRef, useState } from 'react';

import type { MoneroKeyMaterial } from '../../lib/wallet/moneroWallet';

interface KeyRow {
  label: string;
  value: string;
  secret?: boolean;
}

interface MoneroKeyListProps {
  material: MoneroKeyMaterial;
}

function truncateMiddle(value: string, lead = 10, tail = 8): string {
  if (value.length <= lead + tail + 1) {
    return value;
  }
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

function MoneroKeyList({ material }: MoneroKeyListProps) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  async function onCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedLabel(null), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  const rows: KeyRow[] = [
    { label: 'Address', value: material.address },
    { label: 'Private spend key', value: material.privateSpendKey, secret: true },
    { label: 'Private view key', value: material.privateViewKey, secret: true },
    { label: 'Public spend key', value: material.publicSpendKey },
    { label: 'Public view key', value: material.publicViewKey },
  ];

  return (
    <div className="mono-key-list">
      {rows.map((row) => (
        <div key={row.label} className={`mono-key-row${row.secret ? ' mono-key-secret' : ''}`}>
          <span className="mono-key-label">
            {row.label}
            {row.secret ? <span className="mono-key-tag">secret</span> : null}
          </span>
          <code className="mono-key-value" title={row.value}>
            {truncateMiddle(row.value)}
          </code>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCopy(row.label, row.value)}
            title={`Copy ${row.label.toLowerCase()}`}
          >
            {copiedLabel === row.label ? '✓' : '⧉'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default MoneroKeyList;
