/**
 * Official Aktum / Adimat subscription invoice PDF (matches admin billing letter).
 */

import { FormalPdf, formatOfficialDate, formatGhsOfficial } from './formalPdf';
import { getSubscriptionPackage, SUBSCRIPTION_PACKAGES, type SubscriptionPackage } from './subscriptionPricing';

export const DEFAULT_INVOICE_PACKAGE_ID = '1y';

export const INVOICE_ISSUER = {
  company: 'Aktum Technologies',
  person: 'BlaisedRich Ndede Ackah',
  address: 'Sekondi-Takoradi',
  region: 'Western Region, Ghana',
  paymentMethod: 'MTN Mobile Money',
  accountName: 'BLAISEDRICH NDEDE ACKAH',
  accountNumber: '0555857224',
};

export interface StoreInvoiceBillTo {
  ownerName: string;
  storeName: string;
  address: string;
  phones: string;
  storeId?: string;
}

export function invoiceNumberFor(date = new Date(), storeId?: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const tail = (storeId || '').replace(/-/g, '').slice(-4).toUpperCase() || '0001';
  return `ADI-${y}-${m}${d}${tail}`.slice(0, 18);
}

export function packageInvoiceDescription(pkg: SubscriptionPackage): string {
  if (pkg.months === 12) {
    return '1-Year Subscription (Annual discount applied to standard 70 GH₵/month base rate)';
  }
  if (pkg.months === 1) return '1-Month Subscription';
  if (pkg.months % 12 === 0) {
    const years = pkg.months / 12;
    return `${years}-Year Subscription`;
  }
  return `${pkg.months}-Month Subscription`;
}

export function downloadStoreSubscriptionInvoice(opts: {
  billTo: StoreInvoiceBillTo;
  packageId?: string;
  issuedAt?: Date;
}): { filename: string; invoiceNumber: string; amount: number } {
  const issuedAt = opts.issuedAt || new Date();
  const pkg = getSubscriptionPackage(opts.packageId || DEFAULT_INVOICE_PACKAGE_ID)
    || SUBSCRIPTION_PACKAGES.find((p) => p.id === DEFAULT_INVOICE_PACKAGE_ID)!;
  const amount = pkg.baseGhs;
  const invoiceNumber = invoiceNumberFor(issuedAt, opts.billTo.storeId);
  const money = formatGhsOfficial(amount, 'GHS').replace(/^GH₵\s?/, '');

  const pdf = new FormalPdf(
    {
      name: INVOICE_ISSUER.company,
      address: `${INVOICE_ISSUER.person} · ${INVOICE_ISSUER.address} · ${INVOICE_ISSUER.region}`,
      phone: INVOICE_ISSUER.accountNumber,
    },
    {
      title: 'INVOICE',
      documentLabel: 'TAX INVOICE',
      subtitle: `Date: ${formatOfficialDate(issuedAt)}`,
      period: `Invoice #: ${invoiceNumber}`,
      notes: ['Thank you for choosing Adimat POS. We appreciate your business.'],
      generatedAt: issuedAt,
    }
  );

  pdf.section('From');
  pdf.paragraph(
    `${INVOICE_ISSUER.company}\n${INVOICE_ISSUER.person}\n${INVOICE_ISSUER.address}\n${INVOICE_ISSUER.region}`
  );

  pdf.section('Bill to');
  const billLines = [
    opts.billTo.ownerName,
    opts.billTo.storeName,
    opts.billTo.address,
    opts.billTo.phones,
  ].filter(Boolean);
  pdf.paragraph(billLines.join('\n'));

  pdf.section('Service');
  pdf.dataTable(
    ['Service', 'Description', 'Rate (GH₵)', 'Total (GH₵)'],
    [['Adimat POS', packageInvoiceDescription(pkg), money, money]],
    [1.2, 2.6, 1.1, 1.1]
  );

  pdf.section('Payment details');
  pdf.kvTable([
    { label: 'Method', value: INVOICE_ISSUER.paymentMethod },
    { label: 'Account name', value: INVOICE_ISSUER.accountName },
    { label: 'Number', value: INVOICE_ISSUER.accountNumber },
    { label: 'Total due', value: `${money} GH₵`, emphasis: 'total' },
  ]);

  const filename = `Invoice_${opts.billTo.storeName.replace(/[^\w]+/g, '_').slice(0, 40)}_${invoiceNumber}.pdf`;
  pdf.save(filename);
  return { filename, invoiceNumber, amount };
}
