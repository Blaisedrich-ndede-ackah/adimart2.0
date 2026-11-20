import { roundMoney } from '@/lib/money';

export type StorePromoType = 'sale_price' | 'percent' | 'fixed' | 'multibuy' | 'coupon';

export interface PromoDefinition {
  id: string;
  name: string;
  promo_type: StorePromoType;
  product_id?: string | null;
  category?: string | null;
  sale_price?: number | null;
  percent_off?: number | null;
  amount_off?: number | null;
  buy_quantity?: number | null;
  free_quantity?: number | null;
  coupon_code?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: number | boolean | null;
}

export interface PromoLineInput {
  id: string;
  product_id: string;
  category?: string | null;
  quantity: number;
  list_unit_price: number;
}

export interface PromoLineResult {
  id: string;
  unit_price: number;
  subtotal: number;
  promotion_discount: number;
  promotion_label: string;
  list_unit_price: number;
}

export interface PromoApplication {
  lines: PromoLineResult[];
  promotionDiscount: number;
  promotionSummary: string;
  couponApplied: boolean;
}

export function promotionIsLive(promo: PromoDefinition, now = new Date()): boolean {
  if (promo.is_active === 0 || promo.is_active === false) return false;
  if (promo.starts_at) {
    const start = Date.parse(promo.starts_at);
    if (Number.isFinite(start) && start > now.getTime()) return false;
  }
  if (promo.ends_at) {
    const end = Date.parse(promo.ends_at);
    if (Number.isFinite(end) && end < now.getTime()) return false;
  }
  return true;
}

function codeOf(promo: PromoDefinition): string {
  return (promo.coupon_code || '').trim().toLowerCase();
}

function matches(promo: PromoDefinition, line: PromoLineInput): boolean {
  if (promo.product_id) return promo.product_id === line.product_id;
  const category = (promo.category || '').trim().toLowerCase();
  if (category) return category === (line.category || '').trim().toLowerCase();
  return true;
}

function bestPercent(promos: PromoDefinition[], line: PromoLineInput): PromoDefinition | null {
  let best: PromoDefinition | null = null;
  let bestPct = 0;
  for (const promo of promos) {
    if (!matches(promo, line)) continue;
    const pct = Math.max(0, Math.min(100, Number(promo.percent_off) || 0));
    if (pct > bestPct) {
      best = promo;
      bestPct = pct;
    }
  }
  return best;
}

export function applyPromotionPricing(
  lines: PromoLineInput[],
  promos: PromoDefinition[],
  couponCode = '',
  now = new Date()
): PromoApplication {
  const live = promos.filter((promo) => promotionIsLive(promo, now));
  const entered = couponCode.trim().toLowerCase();
  const automatic = live.filter((promo) => !codeOf(promo));
  const coupon = entered
    ? live.find((promo) => codeOf(promo) === entered) || null
    : null;

  const priced = lines.map((line) => {
    const list = roundMoney(Math.max(0, line.list_unit_price));
    const qty = Math.max(0, line.quantity);
    let unit = list;
    const labels: string[] = [];
    const sale = automatic
      .filter((promo) => promo.promo_type === 'sale_price' && matches(promo, line))
      .map((promo) => ({ promo, price: roundMoney(Number(promo.sale_price) || 0) }))
      .filter((entry) => entry.price > 0 && entry.price < unit)
      .sort((a, b) => a.price - b.price)[0];
    if (sale) {
      unit = sale.price;
      labels.push(sale.promo.name);
    }
    let extra = 0;
    const percent = bestPercent(
      automatic.filter((promo) => promo.promo_type === 'percent' || promo.promo_type === 'coupon'),
      line
    );
    if (percent) {
      const pct = Math.max(0, Math.min(100, Number(percent.percent_off) || 0));
      extra += roundMoney(unit * qty * pct / 100);
      labels.push(percent.name);
    }
    for (const promo of automatic.filter((item) => item.promo_type === 'fixed' && matches(item, line))) {
      const off = roundMoney(Math.max(0, Number(promo.amount_off) || 0) * qty);
      extra += off;
      labels.push(promo.name);
    }
    const multibuy = automatic
      .filter((promo) => promo.promo_type === 'multibuy' && matches(promo, line))
      .map((promo) => {
        const buy = Math.max(0, Math.floor(Number(promo.buy_quantity) || 0));
        const free = Math.max(0, Math.floor(Number(promo.free_quantity) || 0));
        const group = buy + free;
        const freeUnits = group > 0 ? Math.floor(qty / group) * free : 0;
        return { promo, savings: roundMoney(freeUnits * unit) };
      })
      .sort((a, b) => b.savings - a.savings)[0];
    if (multibuy && multibuy.savings > 0) {
      extra += multibuy.savings;
      labels.push(multibuy.promo.name);
    }
    const gross = roundMoney(unit * qty);
    extra = Math.min(gross, roundMoney(extra));
    return {
      id: line.id,
      list_unit_price: list,
      unit_price: unit,
      promotion_discount: extra,
      promotion_label: labels.filter(Boolean).join(', '),
      subtotal: roundMoney(gross - extra),
    };
  });

  if (coupon && matchesAny(coupon, lines)) {
    if (coupon.promo_type === 'percent' || (coupon.promo_type === 'coupon' && (Number(coupon.percent_off) || 0) > 0 && !(Number(coupon.amount_off) > 0))) {
      const pct = Math.max(0, Math.min(100, Number(coupon.percent_off) || 0));
      for (const line of priced) {
        const source = lines.find((item) => item.id === line.id);
        if (!source || !matches(coupon, source)) continue;
        const off = Math.min(line.subtotal, roundMoney(line.subtotal * pct / 100));
        line.promotion_discount = roundMoney(line.promotion_discount + off);
        line.subtotal = roundMoney(line.subtotal - off);
        line.promotion_label = [line.promotion_label, coupon.name].filter(Boolean).join(', ');
      }
    } else if (coupon.promo_type === 'sale_price') {
      for (const line of priced) {
        const source = lines.find((item) => item.id === line.id);
        if (!source || !matches(coupon, source)) continue;
        const sale = roundMoney(Number(coupon.sale_price) || 0);
        if (sale <= 0 || sale >= line.unit_price) continue;
        const gross = roundMoney(sale * source.quantity);
        const previous = line.subtotal;
        line.unit_price = sale;
        line.subtotal = Math.min(previous, gross);
        line.promotion_discount = roundMoney(line.list_unit_price * source.quantity - line.subtotal);
        line.promotion_label = [line.promotion_label, coupon.name].filter(Boolean).join(', ');
      }
    } else {
      let remaining = roundMoney(Math.max(0, Number(coupon.amount_off) || 0));
      for (const line of priced) {
        if (remaining <= 0) break;
        const source = lines.find((item) => item.id === line.id);
        if (!source || !matches(coupon, source)) continue;
        const off = Math.min(line.subtotal, remaining);
        line.promotion_discount = roundMoney(line.promotion_discount + off);
        line.subtotal = roundMoney(line.subtotal - off);
        line.promotion_label = [line.promotion_label, coupon.name].filter(Boolean).join(', ');
        remaining = roundMoney(remaining - off);
      }
    }
  }

  const promotionDiscount = roundMoney(priced.reduce((sum, line) => sum + line.promotion_discount, 0));
  const names = [...new Set(priced.flatMap((line) => line.promotion_label.split(', ').filter(Boolean)))];
  return {
    lines: priced,
    promotionDiscount,
    promotionSummary: names.join(', '),
    couponApplied: Boolean(coupon),
  };
}

function matchesAny(promo: PromoDefinition, lines: PromoLineInput[]): boolean {
  if (!promo.product_id && !(promo.category || '').trim()) return true;
  return lines.some((line) => matches(promo, line));
}
