import { browser } from 'wxt/browser';
import { scanMoneroBalance } from '../../lib/monero/moneroDaemon';
import { ScanJobs, scanJobKey } from '../../lib/monero/scanJobs';
import './style.css';

let currentKey: string | undefined;
const status = document.querySelector<HTMLElement>('#status')!;
const jobs = new ScanJobs(scanMoneroBalance, (key, event) => {
  if (key === currentKey)
    status.textContent =
      event.type === 'progress'
        ? `Block ${event.progress.scannedHeight.toLocaleString()} / ${event.progress.targetHeight.toLocaleString()}`
        : event.result.ok
          ? 'Scan complete'
          : (event.result.error ?? 'Scan failed');
  void browser.runtime
    .sendMessage({ type: 'monero:scanEvent', key, event })
    .catch((error) => console.error('Monero scan viewer notification failed', error));
});
document.querySelector('#stop')!.addEventListener('click', () => {
  if (currentKey) jobs.stop(currentKey);
});
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
        currentKey = scanJobKey(message.request);
        jobs.start(message.request);
      }
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
