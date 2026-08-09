import type { LocalProduct } from '@/lib/dexie';

export type WholesaleMode = 'none' | 'pack' | 'unit_discount' | 'tiers';

export type WholesaleTier = {
  min_qty: number;
  unit_price: number;
};

export type SaleMode = 'retail' | 'wholesale';
export type UnitType = 'base' | 'pack';

export function parseTiers(json: string | null | undefined): WholesaleTier[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => ({
        min_qty: Number((t as WholesaleTier).min_qty) || 0,
        unit_price: Number((t as WholesaleTier).unit_price) || 0,
      }))
      .filter((t) => t.min_qty > 0)
      .sort((a, b) => a.min_qty - b.min_qty);
  } catch {
    return [];
  }
}

export function serializeTiers(tiers: WholesaleTier[]): string {
  return JSON.stringify(
    tiers
      .map((t) => ({
        min_qty: Number(t.min_qty) || 0,
        unit_price: Number(t.unit_price) || 0,
      }))
      .filter((t) => t.min_qty > 0)
      .sort((a, b) => a.min_qty - b.min_qty)
  );
}

function packSizeOf(product: LocalProduct): number {
  const size = Number(product.pack_size) || 1;
  return size > 0 ? size : 1;
}

function wholesaleModeOf(product: LocalProduct): WholesaleMode {
  const mode = (product.wholesale_mode || 'none') as WholesaleMode;
  if (mode === 'pack' || mode === 'unit_discount' || mode === 'tiers') return mode;
  return 'none';
}

function pickTierPrice(tiers: WholesaleTier[], baseQuantity: number): number | null {
  let best: WholesaleTier | null = null;
  for (const tier of tiers) {
    if (tier.min_qty <= baseQuantity && (!best || tier.min_qty > best.min_qty)) {
      best = tier;
    }
  }
  return best ? best.unit_price : null;
}

export function resolveSalePrice(params: {
  product: LocalProduct;
  saleMode: SaleMode;
  quantity: number;
  unitType: UnitType;
}): { unitPrice: number; baseQuantity: number; label: string } {
  const { product, saleMode, unitType } = params;
  const quantity = Math.max(0, Number(params.quantity) || 0);
  const packSize = packSizeOf(product);
  const baseQuantity = unitType === 'pack' ? quantity * packSize : quantity;
  const retailUnit = Number(product.selling_price) || 0;

  if (saleMode === 'retail') {
    if (unitType === 'pack') {
      return {
        unitPrice: retailUnit * packSize,
        baseQuantity,
        label: 'Retail (pack)',
      };
    }
    return {
      unitPrice: retailUnit,
      baseQuantity,
      label: 'Retail',
    };
  }

  const mode = wholesaleModeOf(product);

  if (mode === 'pack') {
    const packPrice = Number(product.wholesale_pack_price) || 0;
    if (unitType === 'pack') {
      return {
        unitPrice: packPrice,
        baseQuantity,
        label: 'Wholesale (pack)',
      };
    }
    const perUnit = packSize > 0 ? packPrice / packSize : 0;
    return {
      unitPrice: perUnit,
      baseQuantity,
      label: 'Wholesale',
    };
  }

  if (mode === 'unit_discount') {
    const unitPrice = Number(product.wholesale_unit_price) || 0;
    if (unitType === 'pack') {
      return {
        unitPrice: unitPrice * packSize,
        baseQuantity,
        label: 'Wholesale (pack)',
      };
    }
    return {
      unitPrice,
      baseQuantity,
      label: 'Wholesale',
    };
  }

  if (mode === 'tiers') {
    const tiers = parseTiers(product.wholesale_tiers_json);
    const tierUnit = pickTierPrice(tiers, baseQuantity);
    const unitPrice = tierUnit ?? retailUnit;
    if (unitType === 'pack') {
      return {
        unitPrice: unitPrice * packSize,
        baseQuantity,
        label: tierUnit != null ? 'Wholesale (tier pack)' : 'Retail (pack)',
      };
    }
    return {
      unitPrice,
      baseQuantity,
      label: tierUnit != null ? 'Wholesale (tier)' : 'Retail',
    };
  }

  if (unitType === 'pack') {
    return {
      unitPrice: retailUnit * packSize,
      baseQuantity,
      label: 'Retail (pack)',
    };
  }
  return {
    unitPrice: retailUnit,
    baseQuantity,
    label: 'Retail',
  };
}

export function getAvailableSaleModes(product: LocalProduct): SaleMode[] {
  const mode = wholesaleModeOf(product);
  if (mode === 'none') return ['retail'];
  if (mode === 'pack' && !(Number(product.wholesale_pack_price) > 0)) return ['retail'];
  if (mode === 'unit_discount' && !(Number(product.wholesale_unit_price) > 0)) return ['retail'];
  if (mode === 'tiers' && parseTiers(product.wholesale_tiers_json).length === 0) return ['retail'];
  return ['retail', 'wholesale'];
}
