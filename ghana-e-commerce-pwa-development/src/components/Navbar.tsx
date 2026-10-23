import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingCart, Menu, X, Search, Home, Store, MessageCircle } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useAdimartStore } from '@/lib/AdimartProvider';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { store } = useAdimartStore();
  const storeBrand = { name: store?.name || 'BONDZTECH', logoUrl: store?.logoUrl || '' };
  const location = useLocation();
  const itemCount = useCartStore((s) => s.getItemCount());

  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/products', label: 'Shop', icon: Store },
    { path: '/cart', label: 'Cart', icon: ShoppingCart },
  ];

  return (
    <>
      {/* Desktop / Top Navbar */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-orange-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 shrink-0">
              {storeBrand.logoUrl ? (
                <img
                  src={storeBrand.logoUrl}
                  alt={`${storeBrand.name} logo`}
                  className="h-11 max-w-[170px] object-contain"
                />
              ) : (
                <span className="block text-lg font-black tracking-tight text-gray-900">
                  {storeBrand.name}
                </span>
              )}
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    isActive(link.path)
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                      : 'text-gray-600 hover:text-orange-600 hover:bg-orange-50'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              {/* Search Link */}
              <Link
                to="/products"
                className="hidden md:flex items-center gap-2 px-3 py-2 text-sm text-gray-500 bg-gray-50 rounded-full hover:bg-orange-50 hover:text-orange-600 transition-colors"
                aria-label="Search products"
              >
                <Search className="w-4 h-4" />
                <span>Search products</span>
              </Link>

              {/* Cart */}
              <Link
                to="/cart"
                className="relative p-2 text-gray-600 hover:text-orange-600 transition-colors"
                aria-label="View cart"
              >
                <ShoppingCart className="w-6 h-6" />
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full">
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </Link>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-600 hover:text-orange-600 transition-colors"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-orange-100 shadow-lg">
            <div className="px-4 py-3 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive(link.path)
                      ? 'bg-orange-500 text-white'
                      : 'text-gray-600 hover:bg-orange-50'
                  }`}
                >
                  <link.icon className="w-5 h-5" />
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-orange-100 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-around py-2">
          {[
            { path: '/', label: 'Home', icon: Home },
            { path: '/products', label: 'Shop', icon: Store },
            { path: '/cart', label: 'Cart', icon: ShoppingCart, badge: itemCount },
            { path: '#chat', label: 'Chat', icon: MessageCircle },
          ].map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={(e) => {
                if (item.path === '#chat') {
                  e.preventDefault();
                  const event = new CustomEvent('toggle-chat');
                  window.dispatchEvent(event);
                }
              }}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                isActive(item.path)
                  ? 'text-orange-600'
                  : 'text-gray-400 hover:text-orange-500'
              }`}
            >
              <div className="relative">
                <item.icon className="w-5 h-5" />
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1.5 -right-2 bg-orange-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
