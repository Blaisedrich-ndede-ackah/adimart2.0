import { useState, useEffect } from 'react';
import {
  X, Banknote, CreditCard, Split, Percent, Shield,
  CheckCircle2, Loader2, Printer, AlertTriangle, Share2, Download,
  Smartphone, MessageCircle, CirclePlus, Trash2
} from 'lucide-react';
import { useCartStore, CartItem } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import { getCurrentStoreCustomers, LocalCustomer } from '@/lib/dexie';
import { generatePaystackReference, initializePaystack, isPaystackConfigured, isValidPaystackEmail, resolvePaystackEmail } from '@/lib/paystack';
import { printReceipt, type ReceiptData } from '@/lib/printService';
import { shareReceipt, downloadReceipt, shareViaWhatsApp, PDFReceiptData } from '@/lib/receiptGenerator';
import ProductImage from '@/components/ProductImage';
import {
  OTHER_CHARGE_CATEGORIES,
  type OtherCharge,
  type OtherChargeCategoryId,
} from '@/lib/otherCharges';
import {
  MANUAL_PAYMENT_METHODS,
  isManualPaymentMethod,
  type PaymentMethod,
} from '@/lib/paymentMethods';
import { useFormatMoney, getStoreCurrency } from '@/lib/currency';
import { getBluetoothHardwareStatus } from '@/lib/bluetoothPeripherals';

interface CheckoutOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (receiptNumber: string) => void;
  onConnectPrinter?: () => void;
}

type Step = 'method' | 'discount' | 'charges' | 'pin-verify' | 'cash-input' | 'split-input' | 'manual-payment' | 'credit-input' | 'paystack' | 'processing' | 'success';

interface SaleResult {
  receiptNumber: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  otherCharges: OtherCharge[];
  otherChargesTotal: number;
  total: number;
  paymentMethod?: PaymentMethod;
  cashAmount?: number;
  paystackAmount?: number;
  manualPaymentAmount?: number;
  paystackReference?: string;
  paymentReference?: string;
  customerName?: string;
  customerPhone?: string;
  creditBalance?: number;
  customerBalance?: number;
}

export default function CheckoutOverlay({ isOpen, onClose, onComplete, onConnectPrinter }: CheckoutOverlayProps) {
  const cart = useCartStore();
  const { currentUser, currentStore, verifyOwnerPin } = useAuthStore();
  const money = useFormatMoney();
  const currencySymbol = getStoreCurrency(currentStore?.currency_code).symbol;

  const [step, setStep] = useState<Step>('method');
  const [discountInput, setDiscountInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [manualMethod, setManualMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]['value']>('momo_mtn');
  const [manualReference, setManualReference] = useState('');
  const [creditCustomerId, setCreditCustomerId] = useState('');
  const [creditCustomers, setCreditCustomers] = useState<LocalCustomer[]>([]);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [error, setError] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [printError, setPrintError] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paystackError, setPaystackError] = useState('');
  const [discountMode, setDiscountMode] = useState<'percentage' | 'fixed'>('percentage');
  const [pendingDiscountKind, setPendingDiscountKind] = useState<'percentage' | 'fixed'>('percentage');
  const [pendingDiscountValue, setPendingDiscountValue] = useState(0);
  const [chargeCategoryId, setChargeCategoryId] = useState<OtherChargeCategoryId | null>(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeCustomLabel, setChargeCustomLabel] = useState('');
  const [chargeError, setChargeError] = useState('');

  const discountCap = currentStore?.discount_cap_percentage ?? 10;
  const pinOnDiscount = currentStore?.pin_on_discount_enabled === 1;
  const allowPercentage = (currentStore?.discount_allow_percentage ?? 1) === 1;
  const allowFixed = (currentStore?.discount_allow_fixed ?? 1) === 1;
  const cashierCanDiscount = (currentStore?.cashier_can_discount ?? 1) === 1;
  const isOwner = currentUser?.role === 'owner';
  const canApplyDiscount = isOwner || cashierCanDiscount;
  const discountsEnabled = allowPercentage || allowFixed;

  useEffect(() => {
    if (isOpen) {
      setStep('method');
      setDiscountInput('');
      setPinInput('');
      setPinError('');
      setCashAmount('');
      setManualMethod('momo_mtn');
      setManualReference('');
      setCreditCustomerId('');
      setCreditCustomers([]);
      setSaleResult(null);
      setError('');
      setPaystackError('');
      setPrintError('');
      setCustomerEmail('');
      setDiscountMode(allowPercentage ? 'percentage' : 'fixed');
      setPendingDiscountKind('percentage');
      setPendingDiscountValue(0);
      setChargeCategoryId(null);
      setChargeAmount('');
      setChargeCustomLabel('');
      setChargeError('');
      // Cashiers without discount permission cannot keep a leftover cart discount
      if (!canApplyDiscount && cart.discountAmount > 0) {
        cart.clearDiscount();
      }
    }
  }, [isOpen, allowPercentage, canApplyDiscount]);

  useEffect(() => {
    if (!isOpen) return;
    getCurrentStoreCustomers()
      .then(setCreditCustomers)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load registered customers.');
      });
  }, [isOpen]);

  function buildReceiptData(result: SaleResult, method: PaymentMethod): PDFReceiptData {
    return {
      storeName: currentStore?.name || 'Store',
      storeAddress: currentStore?.address || '',
      supportNumber: currentStore?.support_number || '',
      storeLogoUrl: currentStore?.logo_url || '',
      currencyCode: currentStore?.currency_code || 'GHS',
      receiptNumber: result.receiptNumber,
      cashierName: currentUser?.name || '',
      dateTime: new Date().toLocaleString('en-GH'),
      items: result.items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        subtotal: i.subtotal,
      })),
      subtotal: result.subtotal,
      discount: result.discount,
      otherCharges: result.otherCharges || [],
      total: result.total,
      paymentMethod: method,
      cashAmount: result.cashAmount,
      paystackAmount: result.paystackAmount,
      manualPaymentAmount: result.manualPaymentAmount,
      paystackReference: result.paystackReference,
      paymentReference: result.paymentReference,
      customerName: result.customerName,
      outstandingBalance: method === 'credit' ? undefined : result.creditBalance,
      amountPaid: method === 'credit' ? 0 : result.total,
      balanceAfterPayment: result.customerBalance ?? result.creditBalance,
    };
  }

  function discountExceedsCap(kind: 'percentage' | 'fixed', value: number): boolean {
    if (kind === 'percentage') return value > discountCap;
    const capAmount = (cart.subtotal * discountCap) / 100;
    return value > capAmount + 0.001;
  }

  async function handleDiscountApply() {
    if (!canApplyDiscount) {
      setError('Discount is disabled for cashiers. Ask the store owner.');
      setStep('method');
      return;
    }
    setError('');
    const value = parseFloat(discountInput);
    if (isNaN(value) || value < 0) {
      setError(discountMode === 'percentage' ? 'Enter a valid discount percentage' : 'Enter a valid discount amount');
      return;
    }
    if (discountMode === 'percentage' && value > 100) {
      setError('Percentage cannot exceed 100%');
      return;
    }
    if (discountMode === 'fixed' && value > cart.subtotal) {
      setError('Fixed discount cannot exceed the subtotal');
      return;
    }

    if (discountExceedsCap(discountMode, value) && pinOnDiscount) {
      setPendingDiscountKind(discountMode);
      setPendingDiscountValue(value);
      // Do not write over-cap discount into the cart until PIN succeeds
      setStep('pin-verify');
      return;
    }

    if (discountExceedsCap(discountMode, value) && !isOwner) {
      setError(`Discount exceeds the store cap of ${discountCap}%. Owner PIN is required.`);
      return;
    }

    if (discountMode === 'percentage') cart.setDiscountPercent(value);
    else cart.setDiscountFixed(value);
    setStep('method');
  }

  function openChargesStep() {
    setChargeError('');
    setChargeCategoryId(null);
    setChargeAmount('');
    setChargeCustomLabel('');
    setStep('charges');
  }

  function handleChargeApply() {
    setChargeError('');
    if (!chargeCategoryId) {
      setChargeError('Select a charge category.');
      return;
    }
    const value = parseFloat(chargeAmount);
    if (isNaN(value) || value <= 0) {
      setChargeError('Enter a valid charge amount.');
      return;
    }
    cart.setOtherCharge(
      chargeCategoryId,
      value,
      chargeCategoryId === 'other' ? chargeCustomLabel : undefined
    );
    setStep('method');
  }

  async function handlePinVerify() {
    try {
      const isValid = await verifyOwnerPin(pinInput);
      if (isValid) {
        setPinError('');
        if (pendingDiscountKind === 'percentage') cart.setDiscountPercent(pendingDiscountValue);
        else cart.setDiscountFixed(pendingDiscountValue);
        setStep('method');
      } else {
        setPinError('Invalid owner PIN');
      }
    } catch (pinVerificationError: unknown) {
      setPinError(pinVerificationError instanceof Error ? pinVerificationError.message : 'Could not verify owner PIN.');
    } finally {
      setPinInput('');
    }
  }

  async function handlePinReject() {
    if (pendingDiscountKind === 'percentage') {
      cart.setDiscountPercent(discountCap);
    } else {
      cart.setDiscountFixed(Math.round(((cart.subtotal * discountCap) / 100) * 100) / 100);
    }
    setPendingDiscountValue(0);
    setStep('method');
  }

  async function processSale(
    method: PaymentMethod,
    cashAmt?: number, 
    paystackAmt?: number, 
    paystackRef?: string,
    paymentRef?: string,
    customerName?: string,
    customerPhone?: string,
    customerId?: string
  ) {
    if (!currentUser) return;
    if (!canApplyDiscount && cart.discountAmount > 0) {
      cart.clearDiscount();
    }
    setStep('processing');
    setError('');

    try {
      const result = await cart.completeSale(
        currentUser.id,
        currentUser.name,
        method,
        cashAmt,
        paystackAmt,
        paystackRef,
        paymentRef,
        customerId
      );
      
      const completed: SaleResult = {
        receiptNumber: result.receiptNumber,
        items: result.items,
        subtotal: result.subtotal,
        discount: result.discount,
        otherCharges: result.otherCharges || [],
        otherChargesTotal: result.otherChargesTotal || 0,
        total: result.total,
        paymentMethod: method,
        cashAmount: cashAmt,
        paystackAmount: isManualPaymentMethod(method) ? 0 : paystackAmt,
        manualPaymentAmount: isManualPaymentMethod(method) ? result.total : 0,
        paystackReference: paystackRef,
        paymentReference: paymentRef || paystackRef,
        customerName,
        customerPhone,
        creditBalance: method === 'credit' ? result.total : 0,
        customerBalance: method === 'credit' ? result.customerBalance : undefined,
      };
      setSaleResult(completed);
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('method');
    }
  }

  async function tryPrintReceipt(
    result: SaleResult,
    method: PaymentMethod
  ) {
    if (!currentStore) return;
    setIsPrinting(true);
    setPrintError('');

    try {
      const receiptData: ReceiptData = buildReceiptData(result, method);
      const printResult = await printReceipt(receiptData);
      if (!printResult.success) {
        setPrintError(printResult.error || 'Print failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPrintError(msg || 'Print failed');
    }

    setIsPrinting(false);
  }

  async function handlePrintReceipt() {
    if (!saleResult) return;
    await tryPrintReceipt(
      saleResult,
      saleResult.paymentMethod || 'cash'
    );
  }

  async function handleShareReceipt() {
    if (!saleResult) return;
    setIsSharing(true);
    
    try {
      const receiptData = buildReceiptData(
        saleResult,
        saleResult.paymentMethod || 'cash'
      );
      await shareReceipt(receiptData);
    } catch {
      // Sharing failed
    }
    
    setIsSharing(false);
  }

  function handleWhatsAppReceipt() {
    if (!saleResult) return;
    const receiptData = buildReceiptData(
      saleResult,
      saleResult.paymentMethod || 'cash'
    );
    shareViaWhatsApp(receiptData, currentStore?.support_number);
  }

  function handleDownloadReceipt() {
    if (!saleResult) return;
    const receiptData = buildReceiptData(
      saleResult,
      saleResult.paymentMethod || 'cash'
    );
    downloadReceipt(receiptData);
  }

  function handleCashSale() {
    setCashAmount('');
    setError('');
    setStep('cash-input');
  }

  function handleManualPaymentConfirm() {
    const reference = manualReference.trim();
    if (!reference) {
      setError('Enter the payment reference number.');
      return;
    }
    if (reference.length > 100) {
      setError('Payment reference must be 100 characters or fewer.');
      return;
    }
    processSale(manualMethod, 0, cart.total, '', reference);
  }

  function handleCreditSaleConfirm() {
    const customer = creditCustomers.find((item) => item.id === creditCustomerId && item.is_active === 1);
    if (!customer) {
      setError('Select a registered customer for this credit sale.');
      return;
    }
    processSale('credit', 0, 0, '', '', customer.name, customer.phone, customer.id);
  }

  function handleCashConfirm() {
    const received = Math.round((parseFloat(cashAmount) || 0) * 100) / 100;
    if (isNaN(received) || received < cart.total) {
      setError(`Cash received must be at least ${money(cart.total)}.`);
      return;
    }
    processSale('cash', cart.total, 0, '');
  }

  function handleSplitConfirm() {
    const cash = Math.round((parseFloat(cashAmount) || 0) * 100) / 100;
    if (isNaN(cash) || cash < 0 || cash >= cart.total) {
      setError('Enter a valid cash amount less than total');
      return;
    }
    const paystackAmt = Math.round((cart.total - cash) * 100) / 100;
    if (Math.abs(cash + paystackAmt - cart.total) > 0.009) {
      setError('Split amounts must equal the sale total');
      return;
    }
    const ref = generatePaystackReference();
    handlePaystackPayment(paystackAmt, ref, cash);
  }

  async function handlePaystackSale() {
    if (!isPaystackConfigured()) {
      setPaystackError('Paystack not configured. Add VITE_PAYSTACK_PUBLIC_KEY to environment variables.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPaystackError('No internet. Choose Cash for this sale, or close checkout and try Mobile Money again when reconnected.');
      return;
    }
    
    const ref = generatePaystackReference();
    handlePaystackPayment(cart.total, ref, 0);
  }

  async function handlePaystackPayment(amount: number, reference: string, cashPortion: number) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPaystackError('No internet. Choose Cash for this sale, or reconnect before using Mobile Money.');
      setStep('method');
      return;
    }
    const email = resolvePaystackEmail(customerEmail, reference);

    if (customerEmail.trim() && !isValidPaystackEmail(customerEmail)) {
      setPaystackError('Enter a valid customer email (e.g. customer@gmail.com) or leave blank.');
      setStep('method');
      return;
    }

    setStep('paystack');
    setPaystackError('');

    try {
      await initializePaystack({
        email,
        amount: Math.round(amount * 100),
        reference,
        onSuccess: (ref) => {
          if (cashPortion > 0) {
            processSale('split', cashPortion, amount, ref);
          } else {
            processSale('paystack', 0, amount, ref);
          }
        },
        onClose: () => {
          setStep('method');
          setPaystackError('Payment was cancelled');
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPaystackError(msg);
      setStep('method');
    }
  }

  if (!isOpen) return null;

  return (
    <div className="sheet-backdrop animate-fade-in">
      <div className="sheet-panel animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {step === 'method' && 'Checkout'}
            {step === 'discount' && 'Apply Discount'}
            {step === 'charges' && 'Add Other Charges'}
            {step === 'pin-verify' && 'Owner Authorization'}
            {step === 'cash-input' && 'Cash Payment'}
            {step === 'split-input' && 'Split Payment'}
            {step === 'manual-payment' && 'Record Manual Payment'}
            {step === 'paystack' && 'Processing Payment...'}
            {step === 'processing' && 'Processing...'}
            {step === 'success' && 'Sale Complete!'}
          </h2>
          {step !== 'processing' && step !== 'paystack' && (
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 touch-target">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-5">
          {step !== 'success' && step !== 'processing' && step !== 'paystack' && (
            <div className="bg-gray-50 rounded-xl p-4 mb-5">
              <div className="space-y-2 mb-3 max-h-44 sm:max-h-56 overflow-y-auto">
                {cart.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <ProductImage src={item.image_url} alt="" size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="pos-product-name text-xs font-medium leading-snug text-gray-800">{item.name}</p>
                      <p className="mt-1 text-[10px] text-gray-500">×{item.quantity}</p>
                    </div>
                    <p className="shrink-0 text-right text-xs font-semibold text-gray-800">{money(item.subtotal)}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Subtotal ({cart.items.length} items)</span>
                <span>{money(cart.subtotal)}</span>
              </div>
              {cart.discountAmount > 0 && (
                <div className="flex justify-between text-sm text-red-500 mb-1">
                  <span>
                    Discount
                    {cart.discountKind === 'percentage'
                      ? ` (${cart.discountPercent}%)`
                      : cart.discountKind === 'fixed'
                        ? ' (fixed)'
                        : ''}
                  </span>
                  <span>-{money(cart.discountAmount)}</span>
                </div>
              )}
              {cart.otherCharges.map((charge) => (
                <div key={charge.id} className="flex justify-between items-center text-sm text-gray-700 mb-1">
                  <span className="truncate pr-2">{charge.label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {money(charge.amount)}
                    {step === 'method' && (
                      <button
                        type="button"
                        onClick={() => cart.removeOtherCharge(charge.id)}
                        className="p-1 rounded-md hover:bg-red-50 touch-target"
                        title={`Remove ${charge.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                <span>Grand Total</span>
                <span>{money(cart.total)}</span>
              </div>
            </div>
          )}

          {(error || paystackError) && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error || paystackError}
            </div>
          )}

          {step === 'method' && (
            <div className="space-y-3">
              {discountsEnabled && (
                <button
                  type="button"
                  disabled={!canApplyDiscount}
                  onClick={() => {
                    if (!canApplyDiscount) return;
                    const mode = allowPercentage ? 'percentage' : 'fixed';
                    setDiscountMode(mode);
                    setDiscountInput(
                      mode === 'percentage'
                        ? String(cart.discountKind === 'percentage' ? cart.discountPercent || '' : '')
                        : String(cart.discountKind === 'fixed' ? cart.discountFixed || '' : '')
                    );
                    setStep('discount');
                  }}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition touch-target ${
                    canApplyDiscount
                      ? 'border-gray-200 hover:border-accent hover:bg-amber-50'
                      : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                  }`}
                  aria-disabled={!canApplyDiscount}
                  title={
                    canApplyDiscount
                      ? 'Apply discount'
                      : 'Discount disabled for cashiers — contact the store owner'
                  }
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      canApplyDiscount ? 'bg-amber-100' : 'bg-gray-200'
                    }`}
                  >
                    <Percent className={`w-5 h-5 ${canApplyDiscount ? 'text-accent' : 'text-gray-400'}`} />
                  </div>
                  <div className="text-left flex-1">
                    <p className={`font-semibold ${canApplyDiscount ? 'text-gray-900' : 'text-gray-500'}`}>
                      Apply Discount
                    </p>
                    <p className="text-xs text-gray-500">
                      {!canApplyDiscount
                        ? 'Disabled — only the store owner can apply discounts'
                        : cart.discountAmount > 0
                          ? cart.discountKind === 'fixed'
                            ? `${money(cart.discountAmount)} off`
                            : `${cart.discountPercent}% applied`
                          : 'Percentage or fixed amount'}
                    </p>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={openChargesStep}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary hover:bg-emerald-50 transition touch-target"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CirclePlus className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Add Other Charges</p>
                  <p className="text-xs text-gray-500">
                    {cart.otherCharges.length > 0
                      ? cart.otherCharges
                          .map((c) => `${c.label} ${money(c.amount)}`)
                          .join(' · ')
                      : 'Delivery, packing, service, or other'}
                  </p>
                </div>
              </button>

              <button
                onClick={handleCashSale}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-primary bg-emerald-50 hover:bg-emerald-100 transition touch-target"
              >
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                  <Banknote className="w-5 h-5 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Cash Payment</p>
                  <p className="text-xs text-gray-500">Enter cash received and calculate change</p>
                </div>
              </button>

              <button
                onClick={() => { setCashAmount(''); setStep('split-input'); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary hover:bg-emerald-50 transition touch-target"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Split className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Split Payment</p>
                  <p className="text-xs text-gray-500">Part cash, part mobile money</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setManualReference('');
                  setError('');
                  setStep('manual-payment');
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary hover:bg-emerald-50 transition touch-target"
              >
                <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-violet-600" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">MoMo, Bank or Card Terminal</p>
                  <p className="text-xs text-gray-500">Record an offline payment with its reference</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCreditCustomerId('');
                  setError('');
                  setStep('credit-input');
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-amber-200 hover:border-amber-500 hover:bg-amber-50 transition touch-target"
              >
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-amber-700" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Credit Sale</p>
                  <p className="text-xs text-gray-500">Record the customer and collect payment later</p>
                </div>
              </button>

              <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                <label className="text-sm font-medium text-gray-700 block">
                  Customer email (optional)
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="customer@gmail.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  autoComplete="email"
                />
                <p className="text-xs text-gray-500">
                  Required by Paystack for mobile money and card payments. Leave blank to use a default receipt email.
                </p>
              </div>

              <button
                onClick={handlePaystackSale}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary hover:bg-emerald-50 transition touch-target"
              >
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-green-600" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Mobile Money / Card</p>
                  <p className="text-xs text-gray-500">MTN, Vodafone, AirtelTigo, Card</p>
                </div>
              </button>
              
              {!isPaystackConfigured() && (
                <p className="text-xs text-amber-600 text-center mt-2">
                  ⚠️ Paystack not configured. Add VITE_PAYSTACK_PUBLIC_KEY to enable.
                </p>
              )}
            </div>
          )}

          {step === 'charges' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Select a fee category, then enter the amount to add under the subtotal.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {OTHER_CHARGE_CATEGORIES.map((cat) => {
                  const applied = cart.otherCharges.find((c) => c.id === cat.id);
                  const selected = chargeCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setChargeCategoryId(cat.id);
                        setChargeError('');
                        setChargeAmount(applied ? String(applied.amount) : '');
                        setChargeCustomLabel(cat.id === 'other' ? applied?.label || '' : '');
                      }}
                      className={`p-3 rounded-xl border text-left touch-target ${
                        selected
                          ? 'border-primary bg-emerald-50'
                          : 'border-gray-200 bg-white hover:border-primary/60'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
                      {applied && (
                        <p className="text-[11px] text-primary mt-0.5">
                          {money(applied.amount)} applied
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {chargeCategoryId === 'other' && (
                <input
                  value={chargeCustomLabel}
                  onChange={(e) => setChargeCustomLabel(e.target.value)}
                  placeholder="Custom charge name (optional)"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              )}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Charge amount ({currencySymbol})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center focus:ring-2 focus:ring-primary outline-none"
                  autoFocus={Boolean(chargeCategoryId)}
                />
              </div>
              {chargeError && <p className="text-xs text-red-600">{chargeError}</p>}
              {chargeCategoryId && cart.otherCharges.some((c) => c.id === chargeCategoryId) && (
                <button
                  type="button"
                  onClick={() => {
                    cart.removeOtherCharge(chargeCategoryId);
                    setChargeAmount('');
                    setStep('method');
                  }}
                  className="w-full py-2.5 text-sm text-red-600 font-medium"
                >
                  Remove this charge
                </button>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('method')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleChargeApply}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target"
                >
                  Apply
                </button>
              </div>
            </div>
          )}

          {step === 'discount' && canApplyDiscount && (
            <div className="space-y-4">
              {allowPercentage && allowFixed && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setDiscountMode('percentage'); setDiscountInput(''); }}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target ${
                      discountMode === 'percentage' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Percentage
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDiscountMode('fixed'); setDiscountInput(''); }}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target ${
                      discountMode === 'fixed' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Fixed amount
                  </button>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  {discountMode === 'percentage' ? 'Discount Percentage (%)' : `Discount Amount (${currencySymbol})`}
                </label>
                <input
                  type="number"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  min="0"
                  max={discountMode === 'percentage' ? 100 : undefined}
                  step={discountMode === 'fixed' ? '0.01' : '1'}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  Cap: {discountCap}% of subtotal
                  {discountMode === 'fixed' ? ` (${money(((cart.subtotal * discountCap) / 100))})` : ''}.
                  {pinOnDiscount ? ' Exceeding requires owner PIN.' : ''}
                </p>
              </div>
              {cart.discountAmount > 0 && (
                <button
                  type="button"
                  onClick={() => { cart.clearDiscount(); setDiscountInput(''); setStep('method'); }}
                  className="w-full py-2.5 text-sm text-red-600 font-medium"
                >
                  Remove discount
                </button>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('method')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDiscountApply}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target"
                >
                  Apply
                </button>
              </div>
            </div>
          )}

          {step === 'pin-verify' && (
            <div className="space-y-4" data-block-scanner="true">
              <div className="text-center">
                <Shield className="w-12 h-12 text-accent mx-auto mb-3" />
                <p className="text-sm text-gray-600">
                  Discount of {cart.discountPercent}% exceeds the {discountCap}% cap.
                  Enter owner PIN to authorize.
                </p>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Owner PIN"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-2xl font-semibold text-center tracking-[1em] focus:ring-2 focus:ring-primary outline-none"
                autoFocus
              />
              {pinError && <p className="text-red-500 text-sm text-center">{pinError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={handlePinReject}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Use Cap ({discountCap}%)
                </button>
                <button
                  onClick={handlePinVerify}
                  disabled={pinInput.length !== 4}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target disabled:opacity-50"
                >
                  Authorize
                </button>
              </div>
            </div>
          )}

          {step === 'split-input' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Cash Amount ({currencySymbol})</label>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={e => setCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center focus:ring-2 focus:ring-primary outline-none"
                  min="0"
                  step="0.01"
                  autoFocus
                />
              </div>
              <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Cash</span>
                  <span className="font-medium">{money((parseFloat(cashAmount) || 0))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Mobile Money</span>
                  <span className="font-medium">
                    {money(Math.max(0, cart.total - (parseFloat(cashAmount) || 0)))}
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('method')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Back
                </button>
                <button
                  onClick={handleSplitConfirm}
                  disabled={!cashAmount || parseFloat(cashAmount) <= 0 || parseFloat(cashAmount) >= cart.total}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target disabled:opacity-50"
                >
                  Continue to Pay
                </button>
              </div>
            </div>
          )}

          {step === 'manual-payment' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-violet-50 border border-violet-100 p-4 text-center">
                <p className="text-sm text-gray-600">Amount received</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{money(cart.total)}</p>
                <p className="text-xs text-gray-500 mt-1">This records the payment only; no provider is contacted.</p>
              </div>
              <div>
                <label htmlFor="manual-payment-method" className="text-sm font-medium text-gray-700 mb-2 block">
                  Payment method
                </label>
                <select
                  id="manual-payment-method"
                  value={manualMethod}
                  onChange={(event) => {
                    const selected = MANUAL_PAYMENT_METHODS.find((method) => method.value === event.target.value);
                    if (selected) setManualMethod(selected.value);
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                >
                  {MANUAL_PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="manual-payment-reference" className="text-sm font-medium text-gray-700 mb-2 block">
                  Payment reference number
                </label>
                <input
                  id="manual-payment-reference"
                  value={manualReference}
                  onChange={(event) => {
                    setManualReference(event.target.value);
                    setError('');
                  }}
                  placeholder="Enter the transaction/reference number"
                  maxLength={100}
                  autoComplete="off"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-600 text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setError(''); setStep('method'); }}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleManualPaymentConfirm}
                  disabled={!manualReference.trim()}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target disabled:opacity-50"
                >
                  Complete Sale
                </button>
              </div>
            </div>
          )}

          {step === 'credit-input' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-center">
                <p className="text-sm text-gray-600">Amount due from customer</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{money(cart.total)}</p>
              </div>
              <div>
                <label htmlFor="credit-customer" className="text-sm font-medium text-gray-700 mb-2 block">
                  Registered customer *
                </label>
                <select
                  id="credit-customer"
                  value={creditCustomerId}
                  onChange={(event) => { setCreditCustomerId(event.target.value); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  autoFocus
                >
                  <option value="">Select a customer</option>
                  {creditCustomers.filter((customer) => customer.is_active === 1).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}
                    </option>
                  ))}
                </select>
                {creditCustomers.filter((customer) => customer.is_active === 1).length === 0 && (
                  <p className="mt-2 text-xs text-amber-800">No active customers are registered. Ask the store owner to add the customer in the Customers book before selling on credit.</p>
                )}
              </div>
              {error && <p className="text-sm text-red-600 text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setError(''); setStep('method'); }}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCreditSaleConfirm}
                  disabled={!creditCustomerId}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target disabled:opacity-50"
                >
                  Record Credit Sale
                </button>
              </div>
            </div>
          )}

          {step === 'cash-input' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                <p className="text-sm text-gray-600">Amount due</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{money(cart.total)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Cash received ({currencySymbol})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={cashAmount}
                  onChange={e => {
                    setCashAmount(e.target.value);
                    setError('');
                  }}
                  placeholder="0.00"
                  min={cart.total}
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-xl font-semibold text-center focus:ring-2 focus:ring-primary outline-none"
                  autoFocus
                />
              </div>
              <div className="rounded-xl bg-blue-50 p-4 flex items-center justify-between">
                <span className="text-sm text-gray-600">Change</span>
                <span className="text-xl font-bold text-blue-700">
                  {money(Math.max(0, (parseFloat(cashAmount) || 0) - cart.total))}
                </span>
              </div>
              {error && <p className="text-sm text-red-600 text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setError(''); setStep('method'); }}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCashConfirm}
                  disabled={!cashAmount || parseFloat(cashAmount) < cart.total}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target disabled:opacity-50"
                >
                  Complete Sale
                </button>
              </div>
            </div>
          )}

          {step === 'paystack' && (
            <div className="flex flex-col items-center py-10">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-gray-700 font-medium">Opening payment...</p>
              <p className="text-gray-500 text-sm mt-1">Complete payment in the popup</p>
              <button
                onClick={() => setStep('method')}
                className="mt-6 px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center py-10">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-gray-700 font-medium">Processing sale...</p>
              <p className="text-gray-500 text-sm">Please wait</p>
            </div>
          )}

          {step === 'success' && saleResult && (
            <div className="flex flex-col items-center py-4">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Sale Complete!</h3>
              <p className="text-primary font-mono font-bold text-lg mb-1">{saleResult.receiptNumber}</p>
              <p className="text-2xl font-bold text-gray-900 mb-4">{money(saleResult.total)}</p>
              {saleResult.paymentMethod === 'credit' && (
                <p className="w-full rounded-xl bg-amber-50 px-3 py-2 mb-3 text-center text-sm text-amber-900">
                  Credit for {saleResult.customerName}; account balance {money(saleResult.customerBalance ?? saleResult.creditBalance ?? 0)}
                </p>
              )}

              {isPrinting && (
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-4">
                  <Printer className="w-4 h-4 animate-pulse" />
                  <span>Printing receipt...</span>
                </div>
              )}

              <div className="w-full grid grid-cols-4 gap-2 mb-2">
                <button
                  onClick={handlePrintReceipt}
                  disabled={isPrinting}
                  className="flex items-center justify-center gap-1 py-3 bg-emerald-50 text-emerald-700 rounded-xl font-medium text-xs disabled:opacity-50"
                >
                  {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Print
                </button>
                <button
                  onClick={handleShareReceipt}
                  disabled={isSharing}
                  className="flex items-center justify-center gap-1 py-3 bg-blue-50 text-blue-700 rounded-xl font-medium text-xs disabled:opacity-50"
                >
                  {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  Share
                </button>
                <button
                  onClick={handleWhatsAppReceipt}
                  className="flex items-center justify-center gap-1 py-3 bg-green-50 text-green-700 rounded-xl font-medium text-xs"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                <button
                  onClick={handleDownloadReceipt}
                  className="flex items-center justify-center gap-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium text-xs"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </button>
              </div>

              {printError && (
                <div className="mb-3 text-center">
                  <p className="text-red-700 text-[11px] px-1">{printError}</p>
                  {!getBluetoothHardwareStatus().printerConnected && onConnectPrinter && (
                    <button type="button" onClick={onConnectPrinter} className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">Connect printer</button>
                  )}
                </div>
              )}

              <button
                onClick={() => onComplete(saleResult.receiptNumber)}
                className="w-full py-4 bg-primary text-white rounded-xl font-bold touch-target text-lg mt-2"
              >
                New Sale
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
