import { createPublicClient, custom, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Failure, type Method } from './core';
import { requestBytes, type NetworkOptions } from './network';

const abi = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function uri(uint256 tokenId) view returns (string)',
]);
export type ContractReader = (method: 'supportsInterface' | 'tokenURI' | 'uri', argument: bigint | `0x${string}`) => Promise<unknown>;
function underlyingFailure(error: unknown): Failure | undefined {
  let current: unknown = error;
  for (let i = 0; current && i < 12; i++) {
    if (current instanceof Failure) return current;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
}
function contractError(error: unknown): Failure {
  const failure = underlyingFailure(error);
  if (failure) return failure;
  return new Failure('contract', 'The contract returned no usable URI. The token may not exist or the selected metadata function may not be supported.');
}
export async function chooseUri(read: ContractReader, id: bigint, method: Method) {
  let candidates: ('tokenURI' | 'uri')[] = method === 'auto' ? ['tokenURI', 'uri'] : [method];
  if (method === 'auto') {
    const probe = async (interfaceId: `0x${string}`) => {
      try { return (await read('supportsInterface', interfaceId)) === true; }
      catch (e) { const f = contractError(e); if (f.kind !== 'contract') throw f; return false; }
    };
    const [erc721, erc1155] = await Promise.all([probe('0x5b5e139f'), probe('0x0e89341c')]);
    if (erc1155 && !erc721) candidates = ['uri', 'tokenURI'];
  }
  for (const candidate of candidates) {
    try {
      const raw = await read(candidate, id);
      if (typeof raw !== 'string' || !raw.trim()) throw new Failure('contract', 'The contract returned an empty or invalid URI.');
      return { raw, method: candidate };
    } catch (error) {
      const failure = contractError(error);
      if (failure.kind !== 'contract' || candidate === candidates.at(-1)) throw failure;
    }
  }
  throw new Failure('contract', 'No metadata URI is available.');
}
export async function readTokenUri(rpcUrl: string, contract: `0x${string}`, id: bigint, method: Method, opts: NetworkOptions = {}) {
  let requestId = 0;
  const client = createPublicClient({
    chain: mainnet,
    // Keep all network access inside our permission and timeout handling.
    ccipRead: false,
    transport: custom({ request: async ({ method: rpcMethod, params }) => {
      const response = await requestBytes(rpcUrl, 'rpc', 8 * 1024 * 1024, opts, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: rpcMethod, params }),
      });
      let data;
      try { data = JSON.parse(new TextDecoder().decode(response.bytes)); }
      catch { throw new Failure('rpc', 'The RPC endpoint returned invalid JSON.'); }
      if (data.error) {
        const message = String(data.error.message ?? 'Unknown RPC error');
        if (/revert/i.test(message) || data.error.code === 3) throw new Failure('contract', 'The contract call reverted. Check the token ID or select the other metadata function.');
        throw new Failure('rpc', `RPC error ${data.error.code ?? ''}: ${message.slice(0, 240)}`);
      }
      if (!Object.hasOwn(data, 'result')) throw new Failure('rpc', 'The endpoint did not return a JSON-RPC result.');
      return data.result;
    } }, { retryCount: 0 }),
  });
  try {
    if (await client.getChainId() !== 1) throw new Failure('rpc', 'This endpoint is not Ethereum mainnet (chain ID 1). Change the RPC URL in Settings.');
    const read: ContractReader = async (functionName, argument) => {
      try {
        return await client.readContract({ address: contract, abi, functionName, args: [argument] as never, blockTag: 'latest' });
      } catch (error) { if (opts.signal?.aborted) throw error; throw contractError(error); }
    };
    return await chooseUri(read, id, method);
  } catch (error) {
    if (opts.signal?.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
    throw underlyingFailure(error) ?? new Failure('rpc', 'Unable to read Ethereum mainnet. Check the RPC endpoint and retry.');
  }
}
