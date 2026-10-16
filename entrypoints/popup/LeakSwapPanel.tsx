import { ArrowLeftRight, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import algosdk from 'algosdk';
import algorandLogo from '../../assets/algorand_logo.png';
import moneroLogo from '../../assets/monero_logo.png';
import { listSwapRecords } from '../../lib/wallet/swapRecords';
import { getNetworkSettings } from '../../lib/network/networkStore';
import { formatAtomic } from '../../lib/wallet/formatAtomic';
import { readSwapChainStatus, type SavedSwapStatus } from '../../lib/wallet/swapChainStatus';
import { swapStatus } from '../../lib/wallet/swapStatus';

interface LeakSwapPanelProps {
  lockSecret?: string | null;
}

export default function LeakSwapPanel({ lockSecret }: LeakSwapPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<SavedSwapStatus[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { setSwaps([]); setError(null); }, [lockSecret]);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10000);
    const reload = window.setInterval(() => setRefresh(value => value + 1), 60000);
    return () => { window.clearInterval(clock); window.clearInterval(reload); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!lockSecret) { setLoading(false); return; }
    const secret = lockSecret;
    setLoading(true);
    setError(null);
    async function load() {
      const records = await listSwapRecords(browser.storage.local, secret);
      if (cancelled) return;
      if (!records.length) { setSwaps([]); return; }
      let client: algosdk.Algodv2 | null = null;
      let genesis = '';
      let chainTime: number | undefined;
      try {
        const settings = await getNetworkSettings();
        const endpoint = settings.algorand.algod;
        const node = new algosdk.Algodv2(endpoint.token, endpoint.server, endpoint.port);
        const params = await node.getTransactionParams().do();
        genesis = params.genesisHash ? btoa(String.fromCharCode(...params.genesisHash)) : '';
        client = node;
        const status = await node.status().do();
        const block = await node.block(status.lastRound).do();
        const timestamp = Number(block.block.header.timestamp);
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid chain timestamp.');
        chainTime = timestamp;
      } catch (failure) { console.error('Could not check swap network status.', failure); }
      const loaded = await Promise.all(records.map(record => readSwapChainStatus(record, client, genesis,
        chainTime, Math.floor(Date.now() / 1000))));
      if (!cancelled) setSwaps(loaded);
    }
    load().catch((failure: unknown) => {
      console.error('Could not load saved swaps.', failure);
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Unable to load saved swaps.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [lockSecret, refresh]);
  const rows = swaps.map(swap => ({ ...swap, status: swapStatus(swap, now) }))
    .sort((first, second) => second.status.priority - first.status.priority || first.t1 - second.t1);
  const history = rows.filter(swap => swap.state === 'unavailable');
  const active = rows.filter(swap => !history.includes(swap));

  function swapRow(swap: typeof rows[number]) {
    return <article className="swap-list-item" key={`${swap.genesisHash}:${swap.appId}:${swap.role}`}>
      <div className="swap-row-heading"><h4>Swap {swap.appId}</h4><span>{swap.role === 'ali' ? 'Ali · You send ALGO' : 'Xin · You send XMR'}</span></div>
      <p className={swap.status.priority >= 2 ? 'swap-status urgent' : 'swap-status'} role={swap.status.priority >= 2 ? 'alert' : 'status'}>{swap.status.title}</p>
      <p>{swap.status.detail}</p>
      <dl className="swap-facts">
        {swap.escrowAtomic !== undefined ? <><dt>ALGO escrow</dt><dd>{formatAtomic(swap.escrowAtomic, 6)} ALGO</dd></> : null}
        <dt>Monero network</dt><dd>{swap.moneroNetwork}</dd>
        <dt>Readiness deadline (t0)</dt><dd>{new Date(swap.t0 * 1000).toLocaleString()}</dd>
        <dt>Final expiry (t1)</dt><dd>{new Date(swap.t1 * 1000).toLocaleString()}</dd>
        {swap.chainTime !== undefined ? <><dt>Chain time checked</dt><dd>{new Date(swap.chainTime * 1000).toLocaleString()}</dd></> : null}
      </dl>
      <a className="app-link" href={`https://app.leakswap.com/swap/${swap.appId}`} target="_blank" rel="noreferrer">Open swap <ExternalLink size={16} /></a>
    </article>;
  }

  return <section className="leakswap-view" aria-busy={loading}>
    <h2>LeakSwap</h2>
    <div className="swap-pair" aria-label="Algorand to Monero"><img src={algorandLogo} alt="" /><strong>Algorand</strong><ArrowLeftRight size={18} /><strong>Monero</strong><img src={moneroLogo} alt="" /></div>
    <a className="app-link new-swap" href="https://app.leakswap.com/swap" target="_blank" rel="noreferrer"><Plus size={18} /> New Swap <ExternalLink size={16} /></a>
    <div className="swap-list-heading"><h3>Active swaps ({active.length})</h3>
      <button type="button" className="icon-btn" title="Refresh swap status" aria-label="Refresh swap status" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} className={loading ? 'is-spinning' : ''} /></button>
    </div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && !rows.length ? <p role="status">Loading swaps...</p> : null}
    {!loading && !error && !rows.length ? <p className="hint">No saved swaps yet.</p> : null}
    {!loading && rows.length > 0 && !active.length ? <p className="hint">No active swaps found.</p> : null}
    {active.map(swapRow)}
    {history.length ? <details className="swap-archive" aria-label="Archived swaps">
      <summary>Archived swaps ({history.length})</summary>
      {history.map(swapRow)}
    </details> : null}
  </section>;
}