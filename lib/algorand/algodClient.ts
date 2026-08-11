import algosdk from 'algosdk';

import type { AlgodEndpoint, IndexerEndpoint } from '../network/networks';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAlgodClient(endpoint: AlgodEndpoint): algosdk.Algodv2 {
  return new algosdk.Algodv2(endpoint.token, endpoint.server, endpoint.port === '' ? '' : endpoint.port);
}

export function createIndexerClient(endpoint: IndexerEndpoint): algosdk.Indexer {
  return new algosdk.Indexer(endpoint.token, endpoint.server, endpoint.port === '' ? '' : endpoint.port);
}

export interface AlgodProbeResult {
  ok: boolean;
  lastRound?: number;
  error?: string;
}

export async function probeAlgod(endpoint: AlgodEndpoint): Promise<AlgodProbeResult> {
  try {
    const status = await createAlgodClient(endpoint).status().do();
    return { ok: true, lastRound: Number(status.lastRound) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export interface IndexerProbeResult {
  ok: boolean;
  round?: number;
  version?: string;
  error?: string;
}

export async function probeIndexer(endpoint: IndexerEndpoint): Promise<IndexerProbeResult> {
  try {
    const health = await createIndexerClient(endpoint).makeHealthCheck().do();
    return { ok: true, round: Number(health.round), version: health.version };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export interface BalanceResult {
  ok: boolean;
  algos?: number;
  error?: string;
}

export async function getAlgoBalance(
  endpoint: AlgodEndpoint,
  address: string
): Promise<BalanceResult> {
  try {
    const info = await createAlgodClient(endpoint).accountInformation(address).do();
    return { ok: true, algos: Number(info.amount) / 1e6 };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
