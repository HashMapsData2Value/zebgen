import { browser } from 'wxt/browser';
import { scanMoneroBalance } from '../../lib/monero/moneroDaemon';
import { ScanJobs } from '../../lib/monero/scanJobs';
import './style.css';

const status = document.querySelector<HTMLElement>('#status')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const scans = document.createElement('div');
scans.className = 'scan-list';
document.querySelector('main')!.append(scans);
function renderScans() {
  const states = jobs.states;
  const active = states.filter((job) => !job.result).length;
  status.textContent = active
    ? `${active} active scan${active === 1 ? '' : 's'}`
    : states.length
      ? 'All scans finished'
      : 'Waiting for scan...';
  stop.disabled = active === 0;
  scans.replaceChildren(
    ...states.map((job) => {
      const row = document.createElement('section');
      row.className = 'scan-row';
      const address = document.createElement('p');
      address.className = 'scan-address';
      address.textContent = job.address;
      const progress = document.createElement('p');
      progress.textContent = job.result
        ? job.result.ok
          ? 'Scan complete'
          : (job.result.error ?? 'Scan failed')
        : job.progress
          ? `Block ${job.progress.scannedHeight.toLocaleString()} / ${job.progress.targetHeight.toLocaleString()}`
          : 'Starting scan...';
      row.append(address, progress);
      if (!job.result) {
        const button = document.createElement('button');
        button.textContent = 'Stop scan';
        button.addEventListener('click', () => jobs.stop(job.key));
        row.append(button);
      }
      return row;
    }),
  );
}
const jobs = new ScanJobs(scanMoneroBalance, (key, event) => {
  renderScans();
  void browser.runtime
    .sendMessage({ type: 'monero:scanEvent', key, event })
    .catch((error) => console.error('Monero scan viewer notification failed', error));
});
document.querySelector('#stop')!.addEventListener('click', () => {
  for (const job of jobs.states) if (!job.result) jobs.stop(job.key);
});
stop.textContent = 'Stop all scans';
renderScans();
void navigator.locks
  .request('zebgen-monero-scan-host', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      status.textContent = 'A scan tab is already open';
      return;
    }
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
        return false;
      if (message?.type !== 'monero:hostRequest') return false;
      if (message.action === 'status') {
        sendResponse({ ok: true, active: jobs.isActive(message.key) });
        return false;
      }
      if (message.action === 'stop') jobs.stop(message.key);
      else {
        jobs.start(message.request);
      }
      renderScans();
      sendResponse({ ok: true });
      return false;
    });
    setInterval(() => {
      if (jobs.active)
        void browser.runtime.sendMessage({ type: 'monero:scanHeartbeat' }).catch(console.error);
    }, 10000);
    await browser.runtime.sendMessage({ type: 'monero:scanHostReady' });
    await new Promise<void>(() => {});
  })
  .catch((error) => {
    console.error('Monero scan host failed', error);
    status.textContent = 'Scan host failed';
  });
