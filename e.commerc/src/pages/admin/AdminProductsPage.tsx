import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, Upload, X, Image as ImageIcon, Star, Loader2, Package } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Product, ProductImage } from '@/lib/types';
import toast from 'react-hot-toast';

interface ProductForm {
  name: string;
  description: string;
  price: string;
  category: string;
  stock_quantity: string;
  is_featured: boolean;
}

const emptyForm: ProductForm = {
  name: '',
  description: '',
  price: '',
  category: '',
  stock_quantity: '',
  is_featured: false,
};

const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Home & Garden',
  'Beauty',
  'Sports',
  'Food & Drinks',
  'Phones & Tablets',
  'Computing',
  'Health',
  'Other',
];

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<ProductImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, images:product_images(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setForm(emptyForm);
    setNewImages([]);
    setExistingImages([]);
    setShowModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      stock_quantity: product.stock_quantity.toString(),
      is_featured: product.is_featured,
    });
    setExistingImages(product.images || []);
    setNewImages([]);
    setShowModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const totalImages = existingImages.length + newImages.length + files.length;
    if (totalImages > 5) {
      toast.error('Maximum 5 images per product');
      return;
    }
    setNewImages((prev) => [...prev, ...files]);
  };

  const removeNewImage = (index: number) => {
    setNewImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = async (image: ProductImage) => {
    try {
      await supabase.from('product_images').delete().eq('id', image.id);
      setExistingImages((prev) => prev.filter((img) => img.id !== image.id));
      toast.success('Image removed');
    } catch {
      toast.error('Failed to remove image');
    }
  };

  const setPrimaryImage = async (image: ProductImage) => {
    if (!editingProduct) return;
    try {
      // Unset all primary
      await supabase
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', editingProduct.id);

      // Set new primary
      await supabase
        .from('product_images')
        .update({ is_primary: true })
        .eq('id', image.id);

      setExistingImages((prev) =>
        prev.map((img) => ({ ...img, is_primary: img.id === image.id }))
      );
      toast.success('Primary image set');
    } catch {
      toast.error('Failed to set primary image');
    }
  };

  const uploadImages = async (productId: string): Promise<void> => {
    if (newImages.length === 0) return;
    setUploadingImages(true);

    for (let i = 0; i < newImages.length; i++) {
      const file = newImages[i];
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}/${Date.now()}_${i}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);

      await supabase.from('product_images').insert({
        product_id: productId,
        image_url: urlData.publicUrl,
        is_primary: existingImages.length === 0 && i === 0,
      });
    }

    setUploadingImages(false);
  };

  const handleSave = async () => {
    if (!form.name || !form.price || !form.category) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!isSupabaseConfigured()) {
      toast.error('Supabase is not configured');
      return;
    }

    setSaving(true);

    try {
      const productData = {
        name: form.name,
        description: form.description,
        price: parseFloat(form.price),
        category: form.category,
        stock_quantity: parseInt(form.stock_quantity) || 0,
        is_featured: form.is_featured,
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id);

        if (error) throw error;
        await uploadImages(editingProduct.id);
        toast.success('Product updated!');
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert(productData)
          .select()
          .single();

        if (error) throw error;
        await uploadImages(data.id);
        toast.success('Product created!');
      }

      setShowModal(false);
      fetchProducts();
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;

    try {
      // Delete images from storage
      if (product.images) {
        for (const img of product.images) {
          const path = img.image_url.split('/product-images/')[1];
          if (path) {
            await supabase.storage.from('product-images').remove([path]);
          }
        }
      }

      await supabase.from('product_images').delete().eq('product_id', product.id);
      await supabase.from('products').delete().eq('id', product.id);

      toast.success('Product deleted');
      fetchProducts();
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to delete product');
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-6 h-24 shadow-sm" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 text-sm">{products.length} products</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {/* Products List */}
      {products.length > 0 ? (
        <div className="space-y-3">
          {products.map((product) => {
            const primaryImage =
              product.images?.find((img) => img.is_primary)?.image_url ||
              product.images?.[0]?.image_url;

            return (
              <div
                key={product.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4"
              >
                <div className="w-16 h-16 bg-gray-100 rounded-xl overflow-hidden shrink-0">
                  {primaryImage ? (
                    <img src={primaryImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800 text-sm truncate">{product.name}</h3>
                    {product.is_featured && (
                      <Star className="w-4 h-4 text-yellow-400 fill-current shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{product.category}</p>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="font-bold text-gray-900 text-sm">
                      ₵{product.price.toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-gray-500">
                      Stock: {product.stock_quantity}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEditModal(product)}
                    className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(product)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No products yet. Click "Add Product" to get started.</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProduct ? 'Edit Product' : 'Add Product'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Product Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
                  placeholder="Enter product name"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Description</label>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm resize-none"
                  placeholder="Describe the product"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Price (₵) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Stock Quantity</label>
                  <input
                    type="number"
                    value={form.stock_quantity}
                    onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Category *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm"
                >
                  <option value="">Select category</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_featured}
                  onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
                  className="w-5 h-5 text-orange-500 rounded border-gray-300 focus:ring-orange-300"
                />
                <span className="text-sm font-medium text-gray-700">Featured Product</span>
              </label>

              {/* Images */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Product Images (max 5)
                </label>

                {/* Existing Images */}
                {existingImages.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {existingImages.map((img) => (
                      <div key={img.id} className="relative group w-20 h-20">
                        <img
                          src={img.image_url}
                          alt=""
                          className={`w-full h-full object-cover rounded-xl border-2 ${
                            img.is_primary ? 'border-orange-500' : 'border-gray-200'
                          }`}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 rounded-xl flex items-center justify-center gap-1 transition-opacity">
                          <button
                            onClick={() => setPrimaryImage(img)}
                            className="p-1 bg-white rounded-full"
                            title="Set as primary"
                          >
                            <Star className="w-3 h-3 text-yellow-500" />
                          </button>
                          <button
                            onClick={() => removeExistingImage(img)}
                            className="p-1 bg-white rounded-full"
                            title="Remove"
                          >
                            <X className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                        {img.is_primary && (
                          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                            Primary
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* New Images Preview */}
                {newImages.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {newImages.map((file, i) => (
                      <div key={i} className="relative w-20 h-20">
                        <img
                          src={URL.createObjectURL(file)}
                          alt=""
                          className="w-full h-full object-cover rounded-xl border-2 border-dashed border-orange-300"
                        />
                        <button
                          onClick={() => removeNewImage(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white p-0.5 rounded-full"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={existingImages.length + newImages.length >= 5}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  Upload Images
                </button>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || uploadingImages}
                className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {(saving || uploadingImages) && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingProduct ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

