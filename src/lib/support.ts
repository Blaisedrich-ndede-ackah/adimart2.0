export const WHATSAPP_SUPPORT_PHONE = '233555857224';

export function getWhatsAppSupportUrl(storeName?: string | null): string {
  const businessContext = storeName?.trim() ? ` My business is ${storeName.trim()}.` : '';
  const message = `Hello, I need help with ADIMAT POS.${businessContext}`;
  return `https://wa.me/${WHATSAPP_SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
}
