import type { Env } from "../types";

interface InventoryDescription { classid: string; instanceid: string; marketable: number; market_hash_name?: string }
interface InventoryAsset { classid: string; instanceid: string; amount: string }
interface InventoryResponse { success?: number; total_inventory_count?: number; assets?: InventoryAsset[]; descriptions?: InventoryDescription[] }
interface PriceResponse { success?: boolean; lowest_price?: string; median_price?: string }

export interface InventoryEstimate {
  status: "OK" | "PRIVATE" | "ERROR";
  itemCount?: number;
  valueRub?: number;
  pricedUnique?: number;
  totalUnique?: number;
  limited?: boolean;
}

function parseRub(value?: string): number | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9,.]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

async function marketPrice(env: Env, name: string): Promise<number | null> {
  const cacheKey = `market:${name}`;
  const cached = await env.APPLICATIONS.get(cacheKey);
  if (cached !== null) return Number(cached);
  const url = new URL("https://steamcommunity.com/market/priceoverview/");
  url.searchParams.set("appid", "252490"); url.searchParams.set("currency", "5"); url.searchParams.set("market_hash_name", name);
  const response = await fetch(url, { headers: { "User-Agent": "Rusticket/1.0" } });
  if (!response.ok) return null;
  const result = await response.json<PriceResponse>();
  const price = result.success ? parseRub(result.lowest_price ?? result.median_price) : null;
  if (price !== null) await env.APPLICATIONS.put(cacheKey, String(price), { expirationTtl: 3600 });
  return price;
}

export async function estimateRustInventory(env: Env, steamId64: string): Promise<InventoryEstimate> {
  try {
    const response = await fetch(`https://steamcommunity.com/inventory/${steamId64}/252490/2?l=english&count=5000`, { headers: { "User-Agent": "Rusticket/1.0" } });
    if (response.status === 403 || response.status === 401) return { status: "PRIVATE" };
    if (!response.ok) return { status: "ERROR" };
    const inventory = await response.json<InventoryResponse>();
    if (!inventory.success || !inventory.assets || !inventory.descriptions) return { status: "PRIVATE" };
    const descriptions = new Map(inventory.descriptions.map((d) => [`${d.classid}:${d.instanceid}`, d]));
    const quantities = new Map<string, number>();
    for (const asset of inventory.assets) {
      const description = descriptions.get(`${asset.classid}:${asset.instanceid}`);
      if (!description?.marketable || !description.market_hash_name) continue;
      quantities.set(description.market_hash_name, (quantities.get(description.market_hash_name) ?? 0) + Number(asset.amount || 1));
    }
    const entries = [...quantities.entries()]; const selected = entries.slice(0, 35);
    let valueRub = 0; let pricedUnique = 0;
    for (let index = 0; index < selected.length; index += 5) {
      const batch = selected.slice(index, index + 5);
      const prices = await Promise.all(batch.map(([name]) => marketPrice(env, name)));
      prices.forEach((price, offset) => {
        const entry = batch[offset];
        if (price !== null && entry) { valueRub += price * entry[1]; pricedUnique++; }
      });
    }
    return { status: "OK", itemCount: inventory.total_inventory_count ?? inventory.assets.length, valueRub: Math.round(valueRub), pricedUnique, totalUnique: entries.length, limited: entries.length > selected.length };
  } catch { return { status: "ERROR" }; }
}
