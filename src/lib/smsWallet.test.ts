import { describe, expect, it } from 'vitest';
import {
  canAffordSms,
  customerPhoneOnFile,
  receiptSmsMessage,
  smsCostPesewas,
  smsSegmentCount,
  textsRemaining,
} from './smsPricing';

describe('sms wallet pricing', () => {
  it('charges one unit per recipient for a short text', () => {
    expect(smsSegmentCount('Hello')).toBe(1);
    expect(smsCostPesewas('Hello', 3)).toBe(12);
    expect(smsCostPesewas('   ', 3)).toBe(0);
  });

  it('charges another unit when the text passes 160 characters', () => {
    expect(smsSegmentCount('a'.repeat(161))).toBe(2);
    expect(smsCostPesewas('a'.repeat(161), 2)).toBe(16);
  });

  it('turns the balance into whole texts', () => {
    expect(textsRemaining(0)).toBe(0);
    expect(textsRemaining(7)).toBe(1);
    expect(textsRemaining(500)).toBe(125);
  });

  it('refuses a send the balance cannot cover', () => {
    expect(canAffordSms(4, 'Hello', 1)).toBe(true);
    expect(canAffordSms(3, 'Hello', 1)).toBe(false);
    expect(canAffordSms(8, 'Hello', 3)).toBe(false);
  });

  it('texts a receipt only when that phone is already saved on this store', () => {
    const saved = { store_id: 'store-1', is_active: 1, phone: '0241112222' };
    expect(customerPhoneOnFile(saved, 'store-1')).toBe('233241112222');
    expect(customerPhoneOnFile({ ...saved, is_active: 0 }, 'store-1')).toBe('');
    expect(customerPhoneOnFile({ ...saved, phone: '' }, 'store-1')).toBe('');
    expect(customerPhoneOnFile(saved, 'store-2')).toBe('');
    expect(customerPhoneOnFile(null, 'store-1')).toBe('');
  });

  it('keeps a receipt text inside one message', () => {
    const message = receiptSmsMessage({
      storeName: 'Care Test Shop',
      receiptNumber: '#ADM-1',
      totalLabel: 'GHS 12.00',
    });
    expect(message.length).toBeLessThanOrEqual(160);
    expect(message).toContain('#ADM-1');
    expect(message).toContain('GHS 12.00');
  });
});
