import { browser } from 'wxt/browser';

// Hosts the manifest already grants; anything else needs a runtime optional_host_permissions grant.
const BUILT_IN_HOSTS = new Set(['localhost', '127.0.0.1']);

function originPattern(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') {
      return null;
    }
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Asks the user (in one prompt) for access to every node host not already granted.
 * Call it first thing in a click handler: browsers only show the prompt during a user
 * gesture, and Firefox drops the gesture after any earlier `await`.
 */
export async function ensureHostPermissions(urls: string[]): Promise<void> {
  const origins: string[] = [];
  for (const url of urls) {
    const pattern = originPattern(url);
    if (!pattern) {
      throw new Error(`Invalid node URL: ${url}`);
    }
    if (!BUILT_IN_HOSTS.has(new URL(url).hostname) && !origins.includes(pattern)) {
      origins.push(pattern);
    }
  }
  // permissions.request resolves true without prompting when everything is already granted.
  if (origins.length > 0 && !(await browser.permissions.request({ origins }))) {
    throw new Error(`Permission to connect to ${origins.join(', ')} was declined.`);
  }
}
