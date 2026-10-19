const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;

// Dev and e2e builds keep the old digest-less flow so the legacy manual swap can still be tested.
export const ALLOW_UNBOUND_AGREEMENT_REQUESTS = mode === 'development' || mode === 'e2e';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRequestId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID.test(id);
}

export function assertProviderSender(
  claimedOrigin: unknown,
  sender: { id?: string; url?: string; origin?: string; tab?: { id?: number } },
  extensionId: string,
): void {
  if (sender.id !== extensionId || !Number.isInteger(sender.tab?.id) || !sender.url) {
    throw new Error('Provider requests must come from a browser page.');
  }
  const url = new URL(sender.url);
  if (!['https:', 'http:'].includes(url.protocol) || claimedOrigin !== url.origin
    || (sender.origin !== undefined && sender.origin !== url.origin)) {
    throw new Error('Provider origin does not match the sending page.');
  }
}

// These calls would otherwise hand a page the normal wallet's keys (spend key via a leaky signature, view key via share info and scans).
const AGREEMENT_ONLY_REQUESTS = new Set(['computeMoneroLeakySignature', 'getMoneroShareInfo', 'computeCombinedMoneroAddress', 'scanCombinedMoneroFunding']);

export function assertAgreementBound(type: string, params: unknown, allowUnbound = ALLOW_UNBOUND_AGREEMENT_REQUESTS): void {
  if (type === 'computeMoneroLeakySignature' && (params as { agreementDigest?: unknown } | null)?.agreementDigest !== undefined) {
    throw new Error('Agreement settlements must use settleLeakSwap; revealing signatures are not exported.');
  }
  if (!AGREEMENT_ONLY_REQUESTS.has(type) || allowUnbound) return;
  const digest = (params as { agreementDigest?: unknown } | null)?.agreementDigest;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('This request is only available for a saved swap agreement. Accept the swap invitation in Zebgen first.');
  }
}
