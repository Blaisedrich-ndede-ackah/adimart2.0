import assert from 'node:assert/strict';
import { quantityForProduct, roundStockQty } from '../src/lib/measure';
import { isCountedSale } from '../src/lib/saleStatus';
import { pointsEarned, pointsValue, capRedeemPoints } from '../src/lib/loyaltyMath';
import { evaluateCreditLimit, isOverdueCreditSale, creditDueDate } from '../src/lib/creditMath';
import { payableBalance, receivedPayableValue, isOverduePayable } from '../src/lib/payablesMath';
import { applyPromotionPricing, type PromoDefinition } from '../src/lib/promotions';

assert.equal(roundStockQty(5), 5);
assert.equal(roundStockQty(2.5), 2.5);
assert.equal(roundStockQty(2.0004), 2);
assert.equal(quantityForProduct(2.9, false), 2);
assert.equal(quantityForProduct(2.5, true), 2.5);

assert.equal(isCountedSale({ status: 'completed', void_status: 'none' }), true);
assert.equal(isCountedSale({ status: 'completed', void_status: 'voided' }), false);
assert.equal(isCountedSale({ status: 'pending' }), false);

assert.equal(pointsEarned(25.5, 2), 51);
assert.equal(pointsEarned(10, 0), 0);
assert.equal(pointsValue(10, 0.05), 0.5);
assert.equal(capRedeemPoints(50, 20, 0.1, 1), 10);

const blocked = evaluateCreditLimit({ currentDebt: 80, saleAmount: 30, creditLimit: 100, action: 'block' });
assert.equal(blocked.blocked, true);
const warned = evaluateCreditLimit({ currentDebt: 80, saleAmount: 30, creditLimit: 100, action: 'warn' });
assert.equal(warned.overLimit, true);
assert.equal(warned.blocked, false);
assert.equal(evaluateCreditLimit({ currentDebt: 10, saleAmount: 5, creditLimit: null, action: 'block' }).overLimit, false);

const due = creditDueDate(7, new Date('2026-11-01T12:00:00Z'));
assert.equal(due, '2026-11-08');
assert.equal(isOverdueCreditSale({
  payment_method: 'credit',
  status: 'completed',
  credit_balance: 5,
  credit_due_date: '2026-11-01',
}, '2026-11-02'), true);
assert.equal(isOverdueCreditSale({
  payment_method: 'credit',
  status: 'completed',
  void_status: 'voided',
  credit_balance: 5,
  credit_due_date: '2026-11-01',
}, '2026-11-02'), false);

assert.equal(receivedPayableValue([{ quantity: 10, unit_cost: 4, received_quantity: 2.5 }]), 10);
assert.equal(payableBalance(100, 40), 60);
assert.equal(isOverduePayable({ balance: 60, dueDate: '2026-11-01', status: 'ordered' }, '2026-11-02'), true);

const rice = { id: 'line', product_id: 'rice', category: 'Food', quantity: 3, list_unit_price: 10 };
const multibuy: PromoDefinition = {
  id: 'mb',
  name: 'Buy 2 get 1',
  promo_type: 'multibuy',
  product_id: 'rice',
  buy_quantity: 2,
  free_quantity: 1,
  is_active: 1,
};
const multi = applyPromotionPricing([rice], [multibuy], '', new Date('2026-11-09T12:00:00Z'));
assert.equal(multi.lines[0]?.promotion_discount, 10);
assert.equal(multi.lines[0]?.subtotal, 20);

const coupon: PromoDefinition = {
  id: 'cp',
  name: 'SAVE10',
  promo_type: 'coupon',
  percent_off: 10,
  coupon_code: 'SAVE10',
  is_active: 1,
};
const hidden = applyPromotionPricing([rice], [coupon], '');
assert.equal(hidden.promotionDiscount, 0);
const shown = applyPromotionPricing([rice], [coupon], 'save10');
assert.equal(shown.couponApplied, true);
assert.ok((shown.lines[0]?.promotion_discount || 0) > 0);

const sale: PromoDefinition = {
  id: 'sp',
  name: 'Weekend rice',
  promo_type: 'sale_price',
  product_id: 'rice',
  sale_price: 8,
  starts_at: '2026-11-01T00:00:00Z',
  ends_at: '2026-11-30T00:00:00Z',
  is_active: 1,
};
const timed = applyPromotionPricing([{ ...rice, quantity: 1 }], [sale], '', new Date('2026-11-09T12:00:00Z'));
assert.equal(timed.lines[0]?.unit_price, 8);
assert.equal(timed.lines[0]?.subtotal, 8);

console.log('shop extension checks passed');
