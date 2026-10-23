import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CreditCard, Banknote, Loader2, CheckCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cartStore';
import type { StoreSettings } from '@/lib/types';
import toast from 'react-hot-toast';

declare global {
  interface Window {
    PaystackPop: {
      setup: (config: Record<string, unknown>) => { openIframe: () => void };
    };
  }
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { items, getTotal, clearCart } = useCartStore();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderId, setOrderId] = useState('');

  const [form, setForm] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    delivery_address: '',
    payment_method: 'cash_on_delivery' as 'paystack' | 'cash_on_delivery',
  });

  useEffect(() => {
    fetchSettings();
    // Load Paystack script
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  const fetchSettings = async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data } = await supabase.from('store_settings').select('*').single();
      if (data) setSettings(data);
    } catch {
      // Settings not found, use defaults
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }

    if (!form.customer_name || !form.customer_phone || !form.delivery_address) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (form.payment_method === 'paystack') {
      await handlePaystackPayment();
    } else {
      await createOrder('cash_on_delivery', 'pending');
    }
  };

  const handlePaystackPayment = async () => {
    const paystackKey = settings?.paystack_public_key || import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

    if (!paystackKey || !window.PaystackPop) {
      toast.error('Paystack is not configured. Please try Cash on Delivery.');
      return;
    }

    setLoading(true);

    try {
      const handler = window.PaystackPop.setup({
        key: paystackKey,
        email: form.customer_email || `${form.customer_phone}@BONDZTECH.com`,
        amount: Math.round(getTotal() * 100), // Paystack expects amount in pesewas
        currency: 'GHS',
        ref: `gs_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        callback: async (response: { reference: string }) => {
          await createOrder('paystack', 'paid', response.reference);
        },
        onClose: () => {
          setLoading(false);
          toast.error('Payment cancelled');
        },
      });

      handler.openIframe();
    } catch {
      setLoading(false);
      toast.error('Failed to initialize payment');
    }
  };

  const createOrder = async (
    paymentMethod: string,
    paymentStatus: string,
    paystackRef?: string
  ) => {
    setLoading(true);

    if (!isSupabaseConfigured()) {
      // Demo mode
      setOrderId('demo-' + Date.now());
      setOrderPlaced(true);
      clearCart();
      setLoading(false);
      return;
    }

    try {
      // Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_name: form.customer_name,
          customer_email: form.customer_email,
          customer_phone: form.customer_phone,
          delivery_address: form.delivery_address,
          total_amount: getTotal(),
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          order_status: 'pending',
          paystack_reference: paystackRef || null,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = items.map((item) => ({
        order_id: order.id,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.price,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) throw itemsError;

      // Update stock quantities
      for (const item of items) {
        await supabase
          .from('products')
          .update({ stock_quantity: item.product.stock_quantity - item.quantity })
          .eq('id', item.product.id);
      }

      setOrderId(order.id);
      setOrderPlaced(true);
      clearCart();
      toast.success('Order placed successfully!');
    } catch (error) {
      console.error('Error creating order:', error);
      toast.error('Failed to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Order Confirmation
  if (orderPlaced) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center bg-white rounded-3xl p-8 shadow-lg border border-gray-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Confirmed! </h2>
          <p className="text-gray-500 mb-4">
            Thank you for your order. We'll process it right away.
          </p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-500">Order ID</p>
            <p className="font-mono text-sm font-bold text-gray-800 break-all">{orderId}</p>
          </div>
          <div className="space-y-3">
            <Link
              to="/products"
              className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-full transition-colors"
            >
              Continue Shopping
            </Link>
            <button
              onClick={() => navigate('/')}
              className="block w-full text-gray-500 hover:text-gray-700 font-medium py-3 transition-colors"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Cart is Empty</h2>
          <p className="text-gray-500 mb-6">Add some products before checking out.</p>
          <Link
            to="/products"
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-full font-medium transition-colors"
          >
            Browse Products
          </Link>
        </div>
      </div>
    );
  }

  const paystackAvailable = settings?.paystack_enabled !== false;
  const codAvailable = settings?.cash_on_delivery_enabled !== false;

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/cart"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-500 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Cart
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form Fields */}
            <div className="lg:col-span-2 space-y-6">
              {/* Customer Info */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Customer Information</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.customer_name}
                      onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 text-sm"
                      placeholder="Kwame Asante"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        value={form.customer_phone}
                        onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 text-sm"
                        placeholder="+233 556 466 511"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={form.customer_email}
                        onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 text-sm"
                        placeholder="email@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Delivery Address <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={form.delivery_address}
                      onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 text-sm resize-none"
                      placeholder="House number, street, area, city/town, region"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Method</h2>
                <div className="space-y-3">
                  {paystackAvailable && (
                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        form.payment_method === 'paystack'
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value="paystack"
                        checked={form.payment_method === 'paystack'}
                        onChange={() => setForm({ ...form, payment_method: 'paystack' })}
                        className="sr-only"
                      />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        form.payment_method === 'paystack' ? 'border-orange-500' : 'border-gray-300'
                      }`}>
                        {form.payment_method === 'paystack' && (
                          <div className="w-2.5 h-2.5 bg-orange-500 rounded-full" />
                        )}
                      </div>
                      <CreditCard className="w-5 h-5 text-blue-500" />
                      <div className="flex-1">
                        <p className="font-medium text-gray-800 text-sm">Pay with Paystack</p>
                        <p className="text-xs text-gray-500">Mobile Money, Visa, Mastercard</p>
                      </div>
                    </label>
                  )}

                  {codAvailable && (
                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        form.payment_method === 'cash_on_delivery'
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value="cash_on_delivery"
                        checked={form.payment_method === 'cash_on_delivery'}
                        onChange={() => setForm({ ...form, payment_method: 'cash_on_delivery' })}
                        className="sr-only"
                      />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        form.payment_method === 'cash_on_delivery' ? 'border-orange-500' : 'border-gray-300'
                      }`}>
                        {form.payment_method === 'cash_on_delivery' && (
                          <div className="w-2.5 h-2.5 bg-orange-500 rounded-full" />
                        )}
                      </div>
                      <Banknote className="w-5 h-5 text-green-500" />
                      <div className="flex-1">
                        <p className="font-medium text-gray-800 text-sm">Cash on Delivery</p>
                        <p className="text-xs text-gray-500">Pay when your order arrives</p>
                      </div>
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 sticky top-24">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>

                <div className="space-y-3 mb-4">
                  {items.map((item) => (
                    <div key={item.product.id} className="flex justify-between text-sm">
                      <span className="text-gray-600 line-clamp-1 flex-1 mr-2">
                        {item.product.name} × {item.quantity}
                      </span>
                      <span className="font-medium text-gray-800 whitespace-nowrap">
                        ₵{(item.product.price * item.quantity).toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-200 pt-3 mb-6">
                  <div className="flex justify-between">
                    <span className="font-bold text-gray-900">Total</span>
                    <span className="font-bold text-gray-900 text-xl">
                      ₵{getTotal().toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold py-4 rounded-full shadow-lg shadow-orange-300/50 transition-all duration-300"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Place Order — ₵{getTotal().toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
