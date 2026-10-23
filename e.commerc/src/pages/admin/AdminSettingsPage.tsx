import { useState, useEffect, useRef } from 'react';
import { Save, Upload, Loader2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { StoreSettings } from '@/lib/types';
import toast from 'react-hot-toast';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    store_name: 'BONDZTECH',
    logo_url: '',
    cash_on_delivery_enabled: true,
    paystack_enabled: true,
    paystack_public_key: '',
    currency_symbol: '₵',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase.from('store_settings').select('*').single();
      if (data) {
        setSettings(data);
        setForm({
          store_name: data.store_name,
          logo_url: data.logo_url || '',
          cash_on_delivery_enabled: data.cash_on_delivery_enabled,
          paystack_enabled: data.paystack_enabled,
          paystack_public_key: data.paystack_public_key || '',
          currency_symbol: data.currency_symbol || '₵',
        });
      }
    } catch {
      // Settings not found, use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('store-assets')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('store-assets')
        .getPublicUrl(fileName);

      setForm({ ...form, logo_url: urlData.publicUrl });
      toast.success('Logo uploaded!');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload logo');
    }
  };

  const handleSave = async () => {
    if (!isSupabaseConfigured()) {
      toast.error('Supabase is not configured');
      return;
    }

    setSaving(true);

    try {
      const settingsData = {
        store_name: form.store_name,
        logo_url: form.logo_url,
        cash_on_delivery_enabled: form.cash_on_delivery_enabled,
        paystack_enabled: form.paystack_enabled,
        paystack_public_key: form.paystack_public_key,
        currency_symbol: form.currency_symbol,
        updated_at: new Date().toISOString(),
      };

      if (settings) {
        const { error } = await supabase
          .from('store_settings')
          .update(settingsData)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('store_settings')
          .insert(settingsData);
        if (error) throw error;
      }

      toast.success('Settings saved!');
      fetchSettings();
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        <div className="bg-white rounded-2xl p-6 h-64 shadow-sm" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Store Settings</h1>
        <p className="text-gray-500 text-sm">Configure your store preferences</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* General Settings */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">General</h2>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Store Name</label>
              <input
                type="text"
                value={form.store_name}
                onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Currency Symbol</label>
              <input
                type="text"
                value={form.currency_symbol}
                onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Store Logo</label>
              {form.logo_url && (
                <div className="mb-3">
                  <img
                    src={form.logo_url}
                    alt="Logo"
                    className="h-16 w-auto object-contain bg-gray-50 rounded-xl p-2"
                  />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Logo
              </button>
            </div>
          </div>
        </div>

        {/* Payment Settings */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Methods</h2>

          <div className="space-y-4">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer">
              <div>
                <p className="font-medium text-gray-800 text-sm">Paystack</p>
                <p className="text-xs text-gray-500">Accept Mobile Money, Visa, Mastercard</p>
              </div>
              <input
                type="checkbox"
                checked={form.paystack_enabled}
                onChange={(e) => setForm({ ...form, paystack_enabled: e.target.checked })}
                className="w-5 h-5 text-orange-500 rounded border-gray-300 focus:ring-orange-300"
              />
            </label>

            {form.paystack_enabled && (
              <div className="ml-4">
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Paystack Public Key
                </label>
                <input
                  type="text"
                  value={form.paystack_public_key}
                  onChange={(e) => setForm({ ...form, paystack_public_key: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm font-mono"
                  placeholder="pk_live_..."
                />
              </div>
            )}

            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer">
              <div>
                <p className="font-medium text-gray-800 text-sm">Cash on Delivery</p>
                <p className="text-xs text-gray-500">Customers pay when order arrives</p>
              </div>
              <input
                type="checkbox"
                checked={form.cash_on_delivery_enabled}
                onChange={(e) => setForm({ ...form, cash_on_delivery_enabled: e.target.checked })}
                className="w-5 h-5 text-orange-500 rounded border-gray-300 focus:ring-orange-300"
              />
            </label>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white px-6 py-3 rounded-xl font-medium transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>
    </div>
  );
}
