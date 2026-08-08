import { useState, useEffect } from 'react';
import {
  X, Banknote, CreditCard, Split, Percent, Shield,
  CheckCircle2, Loader2, Printer, AlertTriangle, Share2, Download,
  Smartphone, MessageCircle
} from 'lucide-react';
import { useCartStore, CartItem } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import { LocalStore } from '@/lib/dexie';
import { generatePaystackReference, initializePaystack, isPaystackConfigured, isValidPaystackEmail, resolvePaystackEmail } from '@/lib/paystack';
import { isPrinterConnected } from '@/lib/bluetoothPeripherals';
import { printReceipt, type ReceiptData } from '@/lib/printService';
import { shareReceipt, downloadReceipt, shareViaWhatsApp, PDFReceiptData } from '@/lib/receiptGenerator';
import ProductImage from '@/components/ProductImage';

interface CheckoutOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (receiptNumber: string) => void;
}

type Step = 'method' | 'discount' | 'pin-verify' | 'split-input' | 'paystack' | 'processing' | 'success';

interface SaleResult {
  receiptNumber: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod?: 'cash' | 'split' | 'paystack';
  cashAmount?: number;
  paystackAmount?: number;
}

export default function CheckoutOverlay({ isOpen, onClose, onComplete }: CheckoutOverlayProps) {
  const cart = useCartStore();
  const { currentUser, currentStore, verifyOwnerPin } = useAuthStore();

  const [step, setStep] = useState<Step>('method');
  const [discountInput, setDiscountInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [error, setError] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [printError, setPrintError] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paystackError, setPaystackError] = useState('');

  const discountCap = currentStore?.discount_cap_percentage ?? 10;
  const pinOnDiscount = currentStore?.pin_on_discount_enabled === 1;

  useEffect(() => {
    if (isOpen) {
      setStep('method');
      setDiscountInput('');
      setPinInput('');
      setPinError('');
      setCashAmount('');
      setSaleResult(null);
      setError('');
      setPaystackError('');
      setPrintError('');
      setCustomerEmail('');
    }
  }, [isOpen]);

  function buildReceiptData(result: SaleResult, method: 'cash' | 'split' | 'paystack', cashAmt?: number, paystackAmt?: number, paystackRef?: string): PDFReceiptData {
    return {
      storeName: currentStore?.name || 'Store',
      storeAddress: currentStore?.address || '',
      supportNumber: currentStore?.support_number || '',
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
      total: result.total,
      paymentMethod: method,
      cashAmount: cashAmt,
      paystackAmount: paystackAmt,
      paystackReference: paystackRef,
    };
  }

  async function handleDiscountApply() {
    const percent = parseFloat(discountInput);
    if (isNaN(percent) || percent < 0) {
      setError('Enter a valid discount percentage');
      return;
    }

    if (percent > discountCap && pinOnDiscount) {
      cart.setDiscount(percent);
      setStep('pin-verify');
      return;
    }

    cart.setDiscount(Math.min(percent, discountCap));
    setStep('method');
  }

  async function handlePinVerify() {
    const isValid = await verifyOwnerPin(pinInput);
    if (isValid) {
      setPinError('');
      setStep('method');
    } else {
      setPinError('Invalid owner PIN');
      setPinInput('');
    }
  }

  async function handlePinReject() {
    cart.setDiscount(discountCap);
    setStep('method');
  }

  async function processSale(
    method: 'cash' | 'split' | 'paystack', 
    cashAmt?: number, 
    paystackAmt?: number, 
    paystackRef?: string
  ) {
    if (!currentUser) return;
    setStep('processing');
    setError('');

    try {
      const result = await cart.completeSale(
        currentUser.id,
        currentUser.name,
        method,
        cashAmt,
        paystackAmt,
        paystackRef
      );
      
      const completed: SaleResult = {
        ...result,
        paymentMethod: method,
        cashAmount: cashAmt,
        paystackAmount: paystackAmt,
      };
      setSaleResult(completed);
      setStep('success');

      if (isPrinterConnected() && currentStore) {
        await tryPrintReceipt(completed, method, cashAmt, paystackAmt);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('method');
    }
  }

  async function tryPrintReceipt(
    result: SaleResult,
    method: 'cash' | 'split' | 'paystack',
    cashAmt?: number,
    paystackAmt?: number
  ) {
    if (!currentStore) return;
    setIsPrinting(true);
    setPrintError('');

    try {
      const receiptData: ReceiptData = buildReceiptData(result, method, cashAmt, paystackAmt);
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
      saleResult.paymentMethod || 'cash',
      saleResult.cashAmount,
      saleResult.paystackAmount
    );
  }

  async function handleShareReceipt() {
    if (!saleResult) return;
    setIsSharing(true);
    
    try {
      const receiptData = buildReceiptData(saleResult, 'cash');
      await shareReceipt(receiptData);
    } catch {
      // Sharing failed
    }
    
    setIsSharing(false);
  }

  function handleWhatsAppReceipt() {
    if (!saleResult) return;
    const receiptData = buildReceiptData(saleResult, 'cash');
    shareViaWhatsApp(receiptData, currentStore?.support_number);
  }

  function handleDownloadReceipt() {
    if (!saleResult) return;
    const receiptData = buildReceiptData(saleResult, 'cash');
    downloadReceipt(receiptData);
  }

  function handleCashSale() {
    processSale('cash', cart.total, 0, '');
  }

  function handleSplitConfirm() {
    const cash = parseFloat(cashAmount);
    if (isNaN(cash) || cash < 0 || cash >= cart.total) {
      setError('Enter a valid cash amount less than total');
      return;
    }
    const paystackAmt = Math.round((cart.total - cash) * 100) / 100;
    const ref = generatePaystackReference();
    handlePaystackPayment(paystackAmt, ref, cash);
  }

  async function handlePaystackSale() {
    if (!isPaystackConfigured()) {
      setPaystackError('Paystack not configured. Add VITE_PAYSTACK_PUBLIC_KEY to environment variables.');
      return;
    }
    
    const ref = generatePaystackReference();
    handlePaystackPayment(cart.total, ref, 0);
  }

  async function handlePaystackPayment(amount: number, reference: string, cashPortion: number) {
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
      <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {step === 'method' && 'Checkout'}
            {step === 'discount' && 'Apply Discount'}
            {step === 'pin-verify' && 'Owner Authorization'}
            {step === 'split-input' && 'Split Payment'}
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
              <div className="space-y-2 mb-3 max-h-36 overflow-y-auto">
                {cart.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <ProductImage src={item.image_url} alt={item.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500">×{item.quantity}</p>
                    </div>
                    <p className="text-xs font-semibold text-gray-800">GH₵{item.subtotal.toFixed(2)}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Subtotal ({cart.items.length} items)</span>
                <span>GH₵{cart.subtotal.toFixed(2)}</span>
              </div>
              {cart.discountAmount > 0 && (
                <div className="flex justify-between text-sm text-red-500 mb-1">
                  <span>Discount ({cart.discountPercent}%)</span>
                  <span>-GH₵{cart.discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                <span>Total</span>
                <span>GH₵{cart.total.toFixed(2)}</span>
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
              <button
                onClick={() => { setDiscountInput(String(cart.discountPercent || '')); setStep('discount'); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-accent hover:bg-amber-50 transition touch-target"
              >
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Percent className="w-5 h-5 text-accent" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-gray-900">Apply Discount</p>
                  <p className="text-xs text-gray-500">
                    {cart.discountPercent > 0 ? `${cart.discountPercent}% applied` : 'No discount applied'}
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
                  <p className="text-xs text-gray-500">Pay full amount in cash</p>
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

          {step === 'discount' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Discount Percentage (%)</label>
                <input
                  type="number"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  min="0"
                  max="100"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  Cap: {discountCap}%. Exceeding requires owner PIN.
                </p>
              </div>
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
                <label className="text-sm font-medium text-gray-700 mb-2 block">Cash Amount (GH₵)</label>
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
                  <span className="font-medium">GH₵{(parseFloat(cashAmount) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Mobile Money</span>
                  <span className="font-medium">
                    GH₵{Math.max(0, cart.total - (parseFloat(cashAmount) || 0)).toFixed(2)}
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
              <p className="text-2xl font-bold text-gray-900 mb-4">GH₵{saleResult.total.toFixed(2)}</p>

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
                <p className="text-red-500 text-[11px] text-center mb-3 px-1">{printError}</p>
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
