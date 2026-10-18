import { DEFAULTS, ipfsUrl, parseIpfs, settings, type Settings } from './core';
import { IPFS_COMPANION_ID } from './ipfs-companion-id';

export function allowedGatewayRequest(message: unknown, senderId?: string): boolean {
  return senderId === IPFS_COMPANION_ID && !!message && typeof message === 'object' && 'type' in message && message.type === 'tokint-gateway';
}
export function gatewayReply(prefs: Settings) {
  // Never expose the RPC URL: a custom endpoint can include account credentials.
  return { type: 'tokint-gateway', version: 1, gatewayUrl: prefs.gatewayUrl, gatewayStyle: prefs.gatewayStyle };
}
export function gatewaySettings(reply: unknown): Settings {
  if (!reply || typeof reply !== 'object' || !('type' in reply) || reply.type !== 'tokint-gateway' || !('version' in reply) || reply.version !== 1 || !('gatewayUrl' in reply) || typeof reply.gatewayUrl !== 'string' || !('gatewayStyle' in reply) || !['path', 'subdomain'].includes(String(reply.gatewayStyle))) throw new Error('tokint did not return a gateway configuration. Reconnect the shortcut in tokint Settings.');
  return settings({ ...DEFAULTS, gatewayUrl: reply.gatewayUrl, gatewayStyle: reply.gatewayStyle as Settings['gatewayStyle'] });
}
export function ipfsDestination(input: string, prefs: Settings): string {
  const ref = parseIpfs(input);
  if (!ref) throw new Error('Enter a valid CID/path, ipfs:// URI, or IPFS gateway URL.');
  return ipfsUrl(ref, prefs);
}
export function extensionId(value: string): string {
  if (!/^[a-p]{32}$/.test(value)) throw new Error('Connect this shortcut from tokint → Settings → Connect IPFS shortcut.');
  return value;
}
