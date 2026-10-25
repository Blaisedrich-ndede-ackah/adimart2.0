import { beforeEach, describe, expect, it } from 'vitest';
import { suggestBoughtTogether, analyzePairs } from './boughtTogether';
import { analyzeBrief } from './brief';
import { analyzeCashiers } from './cashier';
import { analyzeDebt, fitSms } from './debt';
import { peekDraftPurchaseOrder, saveDraftPurchaseOrder, takeDraftPurchaseOrder } from './draftPo';
import { clearReportMemo, runReport } from './engine';
import { analyzeExpiry } from './expiry';
import { analyzeHeatmap } from './heatmap';
import { analyzeMargins } from './margin';
import { markdownPercent, priceToRestoreMargin } from './pricing';
import { analyzeRestock } from './restock';
import { scoreSmartSearch } from './search';
import { normalizeAiSettings } from './settings';
import type { AiProduct, AiSale, AiSnapshot } from './types';
import { en, fr } from '../i18n';

function at(year: number, month: number, day: number, hour = 11): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function product(partial: Partial<AiProduct> & Pick<AiProduct, 'id' | 'name'>): AiProduct {
  return {
    category: 'Grocery',
    barcode: partial.id,
    sellingPrice: 10,
    costPrice: 5,
    stock: 10,
    reorderLevel: 0,
    active: true,
    ...partial,
  };
}

function sale(partial: Partial<AiSale> & Pick<AiSale, 'id' | 'createdAt'>): AiSale {
  return {
    cashierId: 'ama',
    cashierName: 'Ama',
    total: 10,
    discount: 0,
    status: 'completed',
    locationId: 'main',
    customerId: null,
    creditBalance: 0,
    ...partial,
  };
}

function snapshot(partial: Partial<AiSnapshot> = {}): AiSnapshot {
  return {
    now: at(2026, 10, 23, 15),
    storeName: 'Makola',
    locationId: 'main',
    debtTemplate: '',
    settings: normalizeAiSettings({
      expiryDays: 30,
      deadStockWeeks: 8,
      restockWeeks: 4,
      leadTimeDays: 7,
      coverDays: 7,
      openingHour: 8,
      closingHour: 20,
    }),
    products: [],
    sales: [],
    items: [],
    batches: [],
    locations: [
      { id: 'main', name: 'Shop' },
      { id: 'osu', name: 'Osu' },
    ],
    movements: [],
    returns: [],
    customers: [],
    payments: [],
    reminders: [],
    orders: [],
    suppliers: [],
    ...partial,
  };
}

describe('ADIMAT AI heuristics', () => {
  beforeEach(() => clearReportMemo());

  it('scales markdown from 10% to 20% using days left and velocity', () => {
    expect(markdownPercent({ daysToExpiry: 2, windowDays: 30, stock: 40, weeklySales: 1 })).toBe(20);
    expect(markdownPercent({ daysToExpiry: 28, windowDays: 30, stock: 4, weeklySales: 8 })).toBe(10);
  });

  it('matches milo 400g with a space, and a one-character typo, but not the wrong size', () => {
    const milo = { name: 'Milo Tin 400 g', barcode: '123456', category: 'Drinks' };
    expect(scoreSmartSearch(milo, 'milo 400g')).toBeGreaterThan(0);
    expect(scoreSmartSearch(milo, 'millo')).toBeGreaterThan(0);
    expect(scoreSmartSearch(milo, 'milo 500g')).toBe(0);
    expect(scoreSmartSearch(milo, '123456')).toBe(1000);
  });

  it('suggests a reorder from weekday-weighted demand, open POs, and the reorder level', () => {
    const sales: AiSale[] = [];
    const items = [];
    const start = new Date(2026, 8, 25);
    for (let offset = 0; offset < 28; offset += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      const id = `sale-${offset}`;
      sales.push(sale({ id, createdAt: at(day.getFullYear(), day.getMonth() + 1, day.getDate()) }));
      items.push({ transactionId: id, productId: 'indomie', quantity: 2, subtotal: 10 });
    }
    const base = snapshot({
      products: [product({ id: 'indomie', name: 'Indomie', stock: 3, costPrice: 4, reorderLevel: 0 })],
      sales,
      items,
      suppliers: [{ id: 'sup', name: 'Sample Wholesale' }],
    });
    const [group] = analyzeRestock(base);
    expect(group.lines[0].suggestedQty).toBe(25);
    expect(group.lines[0].daysOfStock).toBe(1.5);
    expect(group.lines[0].whyKey).toBe('ai.why.restock');

    const withOpen = analyzeRestock(snapshot({
      ...base,
      orders: [{
        supplierId: 'sup',
        status: 'ordered',
        createdAt: at(2026, 10, 1),
        lines: [{ productId: 'indomie', quantity: 10, received: 0, unitCost: 4 }],
      }],
    }));
    expect(withOpen[0].lines[0].suggestedQty).toBe(15);

    const gap = analyzeRestock(snapshot({
      products: [product({ id: 'quiet', name: 'Quiet', stock: 1, reorderLevel: 10 })],
    }));
    expect(gap[0].lines[0].suggestedQty).toBe(9);
    expect(gap[0].lines[0].confidence).toBe('low');
    expect(gap[0].lines[0].whyKey).toBe('ai.why.restockLow');
  });

  it('flags expiry, dead stock, and a faster branch', () => {
    const sales: AiSale[] = [sale({ id: 'old', createdAt: at(2026, 8, 10) })];
    for (let offset = 0; offset < 8; offset += 1) {
      sales.push(sale({ id: `osu-${offset}`, createdAt: at(2026, 10, 10 + offset), locationId: 'osu' }));
    }
    const data = snapshot({
      products: [
        product({ id: 'bread', name: 'Bread', stock: 12 }),
        product({ id: 'rice', name: 'Rice 5kg', stock: 10, reorderLevel: 0 }),
        product({ id: 'other', name: 'Other', stock: 1 }),
      ],
      sales,
      items: [
        { transactionId: 'old', productId: 'other', quantity: 1, subtotal: 10 },
        ...sales.filter((row) => row.id.startsWith('osu')).map((row) => ({
          transactionId: row.id,
          productId: 'rice',
          quantity: 2,
          subtotal: 20,
        })),
      ],
      batches: [{
        id: 'bread-batch',
        productId: 'bread',
        locationId: 'main',
        expiryDate: '2026-10-26',
        quantity: 12,
        costPrice: 4,
        createdAt: at(2026, 10, 20),
      }],
      expiringBatchIds: ['bread-batch'],
    });
    const stock = analyzeExpiry(data);
    expect(stock.expiry[0].productName).toBe('Bread');
    expect(stock.expiry[0].daysToExpiry).toBe(3);
    expect(stock.expiry[0].markdownPercent).toBeGreaterThanOrEqual(10);
    expect(stock.expiry[0].markdownPercent).toBeLessThanOrEqual(20);
    const rice = stock.deadStock.find((row) => row.productId === 'rice');
    expect(rice?.transfer?.toLocationName).toBe('Osu');
    expect(rice?.transfer?.quantity).toBeGreaterThan(0);
  });

  it('ranks debt by amount times days and keeps the reminder within 160 characters', () => {
    const data = snapshot({
      debtTemplate: 'Hi {name}, this is {store}. Your outstanding balance is {balance}. Please pay at the store. Thank you!',
      customers: [
        { id: 'a', name: 'Akosua', phone: '0244000001', openingRemaining: 0, createdAt: at(2026, 7, 1), optOut: false },
        { id: 'b', name: 'Yaw', phone: '0244000002', openingRemaining: 0, createdAt: at(2026, 7, 1), optOut: false },
      ],
      sales: [
        sale({ id: 'c1', createdAt: at(2026, 9, 1), customerId: 'a', creditBalance: 100, total: 100 }),
        sale({ id: 'c2', createdAt: at(2026, 8, 1), customerId: 'b', creditBalance: 50, total: 50 }),
      ],
      payments: [
        { customerId: 'a', amount: 10, createdAt: at(2026, 10, 13) },
        { customerId: 'b', amount: 5, createdAt: at(2026, 9, 23) },
      ],
      reminders: [{ customerId: 'a', sentAt: at(2026, 10, 1) }],
    });
    const rows = analyzeDebt(data);
    expect(rows[0].name).toBe('Yaw');
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
    expect(rows[1].whyVars.reminder).toBe('2026-10-01');
    for (const row of rows) expect(row.message.length).toBeLessThanOrEqual(160);
    expect(fitSms('x'.repeat(400)).length).toBeLessThanOrEqual(160);
  });

  it('asks the owner to review a cashier against their own baseline', () => {
    const sales: AiSale[] = [];
    for (let day = 1; day <= 12; day += 1) {
      sales.push(sale({
        id: `base-${day}`,
        createdAt: at(2026, 9, day, 11),
        total: 95,
        discount: 5,
      }));
    }
    for (let day = 18; day <= 22; day += 1) {
      sales.push(sale({
        id: `recent-${day}`,
        createdAt: at(2026, 10, day, 12),
        total: 60,
        discount: 40,
      }));
    }
    for (let day = 1; day <= 10; day += 1) {
      sales.push(sale({
        id: `kofi-base-${day}`,
        createdAt: at(2026, 9, day, 11),
        cashierId: 'kofi',
        cashierName: 'Kofi',
      }));
    }
    for (let day = 19; day <= 22; day += 1) {
      sales.push(sale({
        id: `kofi-night-${day}`,
        createdAt: at(2026, 10, day, 22),
        cashierId: 'kofi',
        cashierName: 'Kofi',
      }));
    }
    const data = snapshot({
      sales,
      returns: [1, 2, 3].map((day) => ({ createdBy: 'kofi', createdAt: at(2026, 10, 20 + day), quantity: 1 })),
      movements: [1, 2, 3].map((day) => ({
        productId: 'p',
        type: 'adjust' as const,
        quantity: 1,
        userId: 'kofi',
        createdAt: at(2026, 10, 20 + day),
      })),
    });
    const flags = analyzeCashiers(data);
    const discount = flags.find((flag) => flag.kind === 'discount');
    expect(discount?.whyKey).toBe('ai.why.cashierDiscount');
    expect(en[discount!.whyKey].toLowerCase()).toContain('review');
    expect(en[discount!.whyKey].toLowerCase()).not.toContain('theft');
    expect(fr[discount!.whyKey].toLowerCase()).not.toContain('vol');
    expect(flags.some((flag) => flag.kind === 'hours' && flag.cashierName === 'Kofi')).toBe(true);
    expect(flags.some((flag) => flag.kind === 'refund')).toBe(true);
    expect(flags.some((flag) => flag.kind === 'adjustment')).toBe(true);
    expect(runReport(data, { includeSensitive: false }).cashierFlags).toEqual([]);
  });

  it('suggests a price that restores the old margin when cost rose', () => {
    expect(priceToRestoreMargin(12, 0.5)).toBe(24);
    const [alert] = analyzeMargins(snapshot({
      products: [product({ id: 'peak', name: 'Peak Milk', sellingPrice: 16, costPrice: 8, stock: 10 })],
      batches: [
        { id: 'old', productId: 'peak', locationId: 'main', expiryDate: null, quantity: 2, costPrice: 8, createdAt: at(2026, 9, 1) },
        { id: 'new', productId: 'peak', locationId: 'main', expiryDate: null, quantity: 8, costPrice: 12, createdAt: at(2026, 10, 20) },
      ],
    }));
    expect(alert.marginBefore).toBe(50);
    expect(alert.marginAfter).toBe(25);
    expect(alert.suggestedPrice).toBe(24);
    expect(alert.whyKey).toBe('ai.why.margin');
  });

  it('counts products bought on the same receipt', () => {
    const data = snapshot({
      products: [
        product({ id: 'milo', name: 'Milo' }),
        product({ id: 'peak', name: 'Peak' }),
        product({ id: 'sugar', name: 'Sugar' }),
      ],
      sales: [sale({ id: 't1', createdAt: at(2026, 10, 20) }), sale({ id: 't2', createdAt: at(2026, 10, 21) })],
      items: [
        { transactionId: 't1', productId: 'milo', quantity: 1, subtotal: 12 },
        { transactionId: 't1', productId: 'peak', quantity: 1, subtotal: 14 },
        { transactionId: 't2', productId: 'milo', quantity: 1, subtotal: 12 },
        { transactionId: 't2', productId: 'peak', quantity: 1, subtotal: 14 },
        { transactionId: 't2', productId: 'sugar', quantity: 1, subtotal: 9 },
      ],
    });
    const suggestions = suggestBoughtTogether(analyzePairs(data), { milo: 'Milo', peak: 'Peak', sugar: 'Sugar' }, ['milo'], 2);
    expect(suggestions[0].name).toBe('Peak');
    expect(suggestions[0].count).toBe(2);
    expect(suggestions.map((row) => row.productId)).not.toContain('milo');
  });

  it('builds a weekday-hour heatmap and says when history is thin', () => {
    const sales: AiSale[] = [];
    for (let index = 0; index < 8; index += 1) {
      sales.push(sale({ id: `mon-${index}`, createdAt: at(2026, 10, 19, 9), total: 20 }));
    }
    sales.push(sale({ id: 'tue', createdAt: at(2026, 10, 20, 15), total: 5 }));
    const heat = analyzeHeatmap(snapshot({ sales }));
    expect(heat.enough).toBe(true);
    expect(heat.busiest[0]).toMatchObject({ weekday: 1, hour: 9 });
    const thin = analyzeBrief(snapshot(), false);
    expect(thin.enoughHistory).toBe(false);
    expect(thin.whyKey).toBe('ai.why.briefLow');
    expect(en[thin.whyKey]).toBe('Not enough sales history yet.');
    expect(fr[thin.whyKey]).toBe('Pas encore assez d’historique de ventes.');
  });

  it('compares yesterday with the previous day and the week average', () => {
    const sales: AiSale[] = [
      sale({ id: 'y1', createdAt: at(2026, 10, 22, 10), total: 40 }),
      sale({ id: 'y2', createdAt: at(2026, 10, 22, 16), total: 60 }),
      sale({ id: 'p', createdAt: at(2026, 10, 21, 11), total: 50 }),
    ];
    for (let day = 15; day <= 20; day += 1) {
      sales.push(sale({ id: `w-${day}`, createdAt: at(2026, 10, day), total: 70 }));
    }
    const brief = analyzeBrief(snapshot({
      sales,
      products: [product({ id: 'milo', name: 'Milo', costPrice: 5 })],
      items: [
        { transactionId: 'y1', productId: 'milo', quantity: 2, subtotal: 40 },
        { transactionId: 'y2', productId: 'milo', quantity: 2, subtotal: 60 },
      ],
    }), true);
    expect(brief.sales).toBe(100);
    expect(brief.previousDaySales).toBe(50);
    expect(brief.weekAverageSales).toBeCloseTo((70 * 6 + 50) / 7, 1);
    expect(brief.profit).toBe(80);
    expect(brief.topItems[0].name).toBe('Milo');
  });

  it('keeps a purchase-order draft in storage until purchasing reads it', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    };
    saveDraftPurchaseOrder({
      supplierId: 'sup',
      supplierName: 'Sample Wholesale',
      notes: 'ADIMAT AI draft',
      lines: [{ productId: 'indomie', productName: 'Indomie', quantity: 12, unitCost: 3 }],
      createdAt: at(2026, 10, 23),
    }, storage);
    expect(peekDraftPurchaseOrder(storage)?.lines[0].quantity).toBe(12);
    expect(takeDraftPurchaseOrder(storage)?.supplierId).toBe('sup');
    expect(peekDraftPurchaseOrder(storage)).toBeNull();
  });

  it('memoizes an unchanged snapshot and clamps settings', () => {
    const data = snapshot({ products: [product({ id: 'p', name: 'P' })] });
    expect(runReport(data, { includeSensitive: true })).toBe(runReport(data, { includeSensitive: true }));
    expect(normalizeAiSettings({ restockWeeks: 99 }).restockWeeks).toBe(8);
    expect(normalizeAiSettings({ restockWeeks: 1 }).restockWeeks).toBe(4);
    expect(normalizeAiSettings({}).expiryDays).toBe(30);
    expect(normalizeAiSettings({ expiryDays: 0 }).expiryDays).toBe(1);
  });
});
