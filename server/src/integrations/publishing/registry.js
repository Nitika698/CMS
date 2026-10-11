import { PLATFORMS } from '../../modules/content/content.constants.js';
import { assertAdapter } from './adapter.js';

/**
 * Which platforms CMS can publish to directly. EMPTY by design: no network integration is implemented or tested,
 * so none is advertised. Registering an adapter here is the single switch that turns a platform on.
 */
const adapters = new Map();

export function registerAdapter(adapter) {
  assertAdapter(adapter);
  adapters.set(adapter.platform, adapter);
}

/** Test hook (and future hot-unplug): remove one adapter, or all of them. */
export function unregisterAdapter(platform) {
  if (platform) adapters.delete(platform);
  else adapters.clear();
}

export const getAdapter = (platform) => adapters.get(platform) ?? null;

/** What the UI may say about each platform. Never claims more than is registered AND configured. */
export async function describePlatforms() {
  return Promise.all(
    PLATFORMS.map(async (platform) => {
      const adapter = getAdapter(platform);
      const configured = adapter ? await adapter.isConfigured().catch(() => false) : false;
      return {
        platform,
        directPublishing: configured,
        mode: configured ? 'api' : 'manual',
        reason: configured ? null : adapter ? 'Not connected to this platform yet' : 'Direct publishing is not available. Publish it yourself, then confirm it in CMS.',
      };
    }),
  );
}
