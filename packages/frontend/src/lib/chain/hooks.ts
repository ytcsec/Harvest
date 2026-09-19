"use client";

import { useCallback, useEffect, useState } from "react";

import { getCampaign, listCampaigns, vaultStats } from "@/lib/chain/harvest";
import { toView, type CampaignView, type ChainCampaign } from "@/lib/campaigns";

/** Every campaign on the deployed contract, newest first. */
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list: ChainCampaign[] = await listCampaigns();
      setCampaigns(list.map((c) => toView(c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { campaigns, loading, error, refresh };
}

/** One campaign by its on-chain id. `campaign` is null when it does not exist. */
export function useCampaign(id: number) {
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!Number.isInteger(id) || id < 1) {
      setCampaign(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const c: ChainCampaign | null = await getCampaign(id);
      setCampaign(c ? toView(c) : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The contract answers an unknown id with NotFound (#3).
      if (/#3\b/.test(message)) setCampaign(null);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { campaign, loading, error, refresh };
}

export interface VaultStats {
  managedUsdc: number;
  idleUsdc: number;
  /** Deployed into DeFindex strategies (none attached on testnet). */
  investedUsdc: number;
  totalShares: number;
  pricePerShare: number;
}

export function useVaultStats() {
  const [stats, setStats] = useState<VaultStats | null>(null);
  useEffect(() => {
    vaultStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  return stats;
}
