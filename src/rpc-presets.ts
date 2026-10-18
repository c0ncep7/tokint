export const RPC_PRESETS = [
  { id: 'publicnode', name: 'PublicNode (default)', url: 'https://ethereum-rpc.publicnode.com', note: 'Public Ethereum mainnet RPC. No account needed.' },
  { id: 'drpc', name: 'dRPC', url: 'https://eth.drpc.org', note: 'Public Ethereum mainnet RPC. No account needed.' },
  { id: '1rpc', name: '1RPC', url: 'https://public.1rpc.io/eth', note: 'Public Ethereum mainnet RPC. No account needed.' },
];
export function rpcPreset(url: string): string {
  try {
    const normalized = new URL(url);
    const match = RPC_PRESETS.find(item => new URL(item.url).href === normalized.href);
    if (match) return match.id;
    if (normalized.origin === 'https://eth-mainnet.g.alchemy.com' && /^\/v2\/[^/]+$/.test(normalized.pathname) && !normalized.search && !normalized.hash && !normalized.username && !normalized.password) return 'alchemy';
  } catch { /* Invalid/custom input remains editable. */ }
  return 'custom';
}
export function validateAlchemyRpc(url: string): void {
  if (rpcPreset(url) !== 'alchemy' || /YOUR_|API_KEY|\{|\}/i.test(url)) throw new Error('Paste your complete Alchemy Ethereum mainnet HTTPS RPC URL from its dashboard.');
}
