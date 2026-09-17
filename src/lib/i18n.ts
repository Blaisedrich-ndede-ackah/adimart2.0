import { create } from 'zustand';
import { useCallback } from 'react';

export type AppLanguage = 'en' | 'fr';

const STORAGE_KEY = 'adimat_language';

export const en: Record<string, string> = {
  'lang.en': 'English',
  'lang.fr': 'Français',
  'lang.switch': 'Language',
  'lang.choose': 'Choose language',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.refresh': 'Refresh',
  'common.downloadPdf': 'Download PDF',
  'common.exportPdf': 'Export PDF',
  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.more': 'More',
  'common.menu': 'Menu',
  'common.search': 'Search',
  'common.all': 'All',
  'common.today': 'Today',
  'common.week': 'Week',
  'common.month': 'Month',
  'common.custom': 'Custom',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.required': 'Required',
  'common.store': 'Store',
  'role.owner': 'Owner',
  'role.cashier': 'Cashier',

  'nav.pos': 'POS',
  'nav.sales': 'Sales',
  'nav.mySales': 'My Sales',
  'nav.expenses': 'Expenses',
  'nav.cashbook': 'Cash Book',
  'nav.devices': 'Devices',
  'nav.plan': 'Plan',
  'nav.inventory': 'Inventory',
  'nav.online': 'Online',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.community': 'Community',
  'nav.switchUser': 'Switch user',
  'nav.moreMenu': 'More menu',

  'community.join': 'Join community chat',
  'community.telegram': 'Telegram group for all users',
  'community.aria': 'Join the Adimat community chat on Telegram',

  'login.enterPin': 'Enter your PIN to continue',
  'login.warehousePin': 'Enter warehouse PIN to open and manage',
  'login.warehouse': 'Warehouse',
  'login.selectStore': 'Select store',
  'login.invalidPin': 'Invalid PIN. Please try again.',
  'login.noStore': 'No store on this device yet. Open it with your Store ID.',
  'login.userNotFound': 'User not found for this store. Please login with PIN.',
  'login.biometricFailed': 'Biometric login failed',
  'login.forgotPin': 'Forgot PIN?',
  'login.admin': 'Admin',
  'login.adminPortal': 'Administrator portal',
  'login.useFingerprint': 'Use fingerprint',
  'login.idleLock': 'You were signed out after inactivity. Enter your PIN to continue.',

  'session.idleTitle': 'Still there?',
  'session.idleCountdown': 'Signing out in {seconds}s',
  'session.idleBody': 'This till will lock to protect the business. Any sale in progress will be cleared.',
  'session.staySignedIn': 'Stay signed in',

  'setup.chooseTitle': 'Open the store your administrator created',
  'setup.letsSetup': 'Open your store',
  'setup.createStore': 'Create New Store',
  'setup.restore': 'Open your store',
  'setup.restoreHint': 'Ask your Adimat administrator for the Store ID and the owner PIN they set for you.',
  'setup.storeIdPlaceholder': 'Paste your Store ID',
  'setup.openStore': 'Open store',
  'setup.storeName': 'Store name',
  'setup.address': 'Address',
  'setup.phone': 'Support phone',
  'setup.ownerName': 'Your name',
  'setup.pin': '4-digit PIN',
  'setup.confirmPin': 'Confirm PIN',
  'setup.next': 'Continue',
  'setup.create': 'Create store',
  'setup.needName': 'Please enter your store name',
  'setup.needAddress': 'Please enter your store address',
  'setup.needPhone': 'Please enter a support phone number',
  'setup.needValidPhone': 'Enter a valid Ghana phone number (e.g. 024XXXXXXX or +23324XXXXXXX)',
  'setup.needOwner': 'Please enter your name',
  'setup.pinLength': 'PIN must be exactly 4 digits',
  'setup.pinMismatch': 'PINs do not match',
  'setup.completeProfile': 'Complete store profile details first',
  'setup.createFailed': 'Failed to create store',
  'setup.needStoreId': 'Enter your Store ID from Settings',
  'setup.needOwnerPin': 'Enter your 4-digit owner PIN',
  'setup.restoreFailed': 'Restore failed',
  'setup.currency': 'Store currency',
  'setup.currencyHint': 'Used on receipts, reports, and prices in this store only.',
  'setup.languageHint': 'You can change language any time. Cashiers can switch too.',

  'settings.title': 'Settings',
  'settings.subtitle': 'Manage your store configuration',
  'settings.profile': 'Store Profile',
  'settings.logo': 'Store logo',
  'settings.logoHint': 'Shown at the top for you and your cashiers after login. Tap Save after changing.',
  'settings.languageCurrency': 'Language & currency',
  'settings.languageHint': 'Applies on this device for every staff member who uses it. Cashiers can also switch from the menu.',
  'settings.currency': 'Store currency',
  'settings.currencyHint': 'This currency is used only in this store — prices, sales, cash book, reports, and receipts. It does not change Adimat subscription fees.',
  'settings.currencySaved': 'Store currency updated',
  'settings.storeNameRequired': 'Store name is required.',
  'settings.addressRequired': 'Store address is required.',
  'settings.phoneRequired': 'Support phone number is required.',
  'settings.validPhone': 'Enter a valid Ghana phone number (e.g. 024XXXXXXX or +23324XXXXXXX).',
  'settings.discountType': 'Enable at least one discount type (percentage or fixed).',
  'settings.saveFailed': 'Failed to save: {error}',
  'settings.saved': 'Saved',
  'settings.saveAll': 'Save all settings',
  'settings.savedBanner': 'Settings saved!',
  'settings.sessionTimeout': 'Automatic session timeout',
  'settings.sessionTimeoutHint': 'Log staff out after inactivity so the till is protected. Applies to owners and cashiers on this store.',
  'settings.sessionTimeout.off': 'Never (stay signed in)',
  'settings.sessionTimeout.minute': '1 minute',
  'settings.sessionTimeout.minutes': '{n} minutes',
  'settings.sessionTimeout.minutesRecommended': '{n} minutes (recommended)',
  'setup.ownerAccount': 'Owner account',
  'setup.yourName': 'Your name',
  'setup.createPin': 'Create 4-digit PIN',
  'setup.continue': 'Continue',

  'pos.search': 'Search products',
  'pos.cart': 'Cart',
  'pos.products': 'Products',
  'pos.checkout': 'Checkout',
  'pos.emptyCart': 'Cart is empty',
  'pos.noProducts': 'No products found',
  'pos.stock': 'Stock',
  'pos.retail': 'Retail',
  'pos.wholesale': 'Wholesale',

  'checkout.cash': 'Cash',
  'checkout.momo': 'Mobile money / card',
  'checkout.split': 'Split payment',
  'checkout.total': 'Total',
  'checkout.subtotal': 'Subtotal',
  'checkout.discount': 'Discount',
  'checkout.pay': 'Pay',
  'checkout.success': 'Sale complete',
  'checkout.downloadPdf': 'Download PDF',
  'checkout.share': 'Share',
  'checkout.print': 'Print',
  'checkout.whatsapp': 'WhatsApp',
  'checkout.newSale': 'New sale',

  'sales.title': 'Sales',
  'sales.myTitle': 'My Sales',
  'expenses.title': 'Expenses',
  'cashbook.title': 'Cash Book',
  'cashbook.ledger': 'Ledger',
  'cashbook.statements': 'Statements',
  'cashbook.income': 'Income',
  'cashbook.expense': 'Expense',
  'cashbook.cat.cashSales': 'Cash sales',
  'cashbook.cat.capital': 'Capital',
  'cashbook.cat.loan': 'Loan',
  'cashbook.cat.refund': 'Refund',
  'cashbook.cat.other': 'Other',
  'cashbook.cat.rent': 'Rent',
  'cashbook.cat.utilities': 'Utilities',
  'cashbook.cat.supplier': 'Supplier',
  'cashbook.cat.salaries': 'Salaries',
  'cashbook.cat.transport': 'Transport',
  'cashbook.cat.withdrawal': 'Withdrawal',
  'reports.title': 'Reports & Analytics',
  'inventory.title': 'Inventory',
  'devices.title': 'Devices',
  'plan.title': 'Plan',
  'warehouse.title': 'Warehouse',
  'online.title': 'Online store',

  'blocked.cashierTitle': 'Account blocked',
  'blocked.storeTitle': 'Store access paused',
};

export const fr: Record<string, string> = {
  'lang.en': 'English',
  'lang.fr': 'Français',
  'lang.switch': 'Langue',
  'lang.choose': 'Choisir la langue',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.close': 'Fermer',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.add': 'Ajouter',
  'common.refresh': 'Actualiser',
  'common.downloadPdf': 'Télécharger le PDF',
  'common.exportPdf': 'Exporter en PDF',
  'common.loading': 'Chargement…',
  'common.retry': 'Réessayer',
  'common.more': 'Plus',
  'common.menu': 'Menu',
  'common.search': 'Rechercher',
  'common.all': 'Tous',
  'common.today': 'Aujourd’hui',
  'common.week': 'Semaine',
  'common.month': 'Mois',
  'common.custom': 'Personnalisé',
  'common.yes': 'Oui',
  'common.no': 'Non',
  'common.required': 'Obligatoire',
  'common.store': 'Boutique',
  'role.owner': 'Propriétaire',
  'role.cashier': 'Caissier',

  'nav.pos': 'Caisse',
  'nav.sales': 'Ventes',
  'nav.mySales': 'Mes ventes',
  'nav.expenses': 'Dépenses',
  'nav.cashbook': 'Livre de caisse',
  'nav.devices': 'Appareils',
  'nav.plan': 'Abonnement',
  'nav.inventory': 'Stock',
  'nav.online': 'En ligne',
  'nav.reports': 'Rapports',
  'nav.settings': 'Paramètres',
  'nav.community': 'Communauté',
  'nav.switchUser': 'Changer d’utilisateur',
  'nav.moreMenu': 'Plus d’options',

  'community.join': 'Rejoindre le chat communautaire',
  'community.telegram': 'Groupe Telegram pour tous les utilisateurs',
  'community.aria': 'Rejoindre le chat communautaire Adimat sur Telegram',

  'login.enterPin': 'Entrez votre code PIN pour continuer',
  'login.warehousePin': 'Entrez le code PIN de l’entrepôt',
  'login.warehouse': 'Entrepôt',
  'login.selectStore': 'Choisir une boutique',
  'login.invalidPin': 'Code PIN incorrect. Réessayez.',
  'login.noStore': 'Aucune boutique sur cet appareil. Ouvrez-la avec votre identifiant.',
  'login.userNotFound': 'Utilisateur introuvable pour cette boutique. Connectez-vous avec le PIN.',
  'login.biometricFailed': 'Échec de la connexion biométrique',
  'login.forgotPin': 'PIN oublié ?',
  'login.admin': 'Admin',
  'login.adminPortal': 'Portail administrateur',
  'login.useFingerprint': 'Utiliser l’empreinte',
  'login.idleLock': 'Vous avez été déconnecté après une période d’inactivité. Entrez votre PIN pour continuer.',

  'session.idleTitle': 'Toujours là ?',
  'session.idleCountdown': 'Déconnexion dans {seconds} s',
  'session.idleBody': 'Cette caisse va se verrouiller pour protéger l’activité. Toute vente en cours sera effacée.',
  'session.staySignedIn': 'Rester connecté',

  'setup.chooseTitle': 'Ouvrez la boutique créée par votre administrateur',
  'setup.letsSetup': 'Ouvrez votre boutique',
  'setup.createStore': 'Créer une boutique',
  'setup.restore': 'Ouvrir votre boutique',
  'setup.restoreHint': 'Demandez à votre administrateur Adimat l’identifiant de boutique et le PIN propriétaire.',
  'setup.storeIdPlaceholder': 'Collez votre identifiant de boutique',
  'setup.openStore': 'Ouvrir la boutique',
  'setup.storeName': 'Nom de la boutique',
  'setup.address': 'Adresse',
  'setup.phone': 'Téléphone d’assistance',
  'setup.ownerName': 'Votre nom',
  'setup.pin': 'PIN à 4 chiffres',
  'setup.confirmPin': 'Confirmer le PIN',
  'setup.next': 'Continuer',
  'setup.create': 'Créer la boutique',
  'setup.needName': 'Veuillez saisir le nom de la boutique',
  'setup.needAddress': 'Veuillez saisir l’adresse de la boutique',
  'setup.needPhone': 'Veuillez saisir un numéro de téléphone',
  'setup.needValidPhone': 'Entrez un numéro ghanéen valide (ex. 024XXXXXXX ou +23324XXXXXXX)',
  'setup.needOwner': 'Veuillez saisir votre nom',
  'setup.pinLength': 'Le PIN doit contenir exactement 4 chiffres',
  'setup.pinMismatch': 'Les PIN ne correspondent pas',
  'setup.completeProfile': 'Complétez d’abord le profil de la boutique',
  'setup.createFailed': 'Impossible de créer la boutique',
  'setup.needStoreId': 'Entrez l’identifiant de boutique depuis Paramètres',
  'setup.needOwnerPin': 'Entrez le PIN propriétaire à 4 chiffres',
  'setup.restoreFailed': 'Échec de la restauration',
  'setup.currency': 'Devise de la boutique',
  'setup.currencyHint': 'Utilisée uniquement sur les reçus, rapports et prix de cette boutique.',
  'setup.languageHint': 'Vous pouvez changer de langue à tout moment. Les caissiers aussi.',

  'settings.title': 'Paramètres',
  'settings.subtitle': 'Configurer votre boutique',
  'settings.profile': 'Profil de la boutique',
  'settings.logo': 'Logo de la boutique',
  'settings.logoHint': 'Affiché en haut pour vous et vos caissiers après connexion. Enregistrez après modification.',
  'settings.languageCurrency': 'Langue et devise',
  'settings.languageHint': 'S’applique sur cet appareil pour tout le personnel. Les caissiers peuvent aussi changer depuis le menu.',
  'settings.currency': 'Devise de la boutique',
  'settings.currencyHint': 'Cette devise est utilisée uniquement dans cette boutique — prix, ventes, livre de caisse, rapports et reçus. Elle ne change pas les frais d’abonnement Adimat.',
  'settings.currencySaved': 'Devise de la boutique mise à jour',
  'settings.storeNameRequired': 'Le nom de la boutique est obligatoire.',
  'settings.addressRequired': 'L’adresse de la boutique est obligatoire.',
  'settings.phoneRequired': 'Le téléphone d’assistance est obligatoire.',
  'settings.validPhone': 'Entrez un numéro ghanéen valide (ex. 024XXXXXXX ou +23324XXXXXXX).',
  'settings.discountType': 'Activez au moins un type de remise (pourcentage ou montant fixe).',
  'settings.saveFailed': 'Échec de l’enregistrement : {error}',
  'settings.saved': 'Enregistré',
  'settings.saveAll': 'Enregistrer tous les paramètres',
  'settings.savedBanner': 'Paramètres enregistrés !',
  'settings.sessionTimeout': 'Déconnexion automatique',
  'settings.sessionTimeoutHint': 'Déconnecte le personnel après inactivité pour protéger la caisse. S’applique aux propriétaires et caissiers de cette boutique.',
  'settings.sessionTimeout.off': 'Jamais (rester connecté)',
  'settings.sessionTimeout.minute': '1 minute',
  'settings.sessionTimeout.minutes': '{n} minutes',
  'settings.sessionTimeout.minutesRecommended': '{n} minutes (recommandé)',
  'setup.ownerAccount': 'Compte propriétaire',
  'setup.yourName': 'Votre nom',
  'setup.createPin': 'Créer un PIN à 4 chiffres',
  'setup.continue': 'Continuer',

  'pos.search': 'Rechercher des produits',
  'pos.cart': 'Panier',
  'pos.products': 'Produits',
  'pos.checkout': 'Paiement',
  'pos.emptyCart': 'Le panier est vide',
  'pos.noProducts': 'Aucun produit',
  'pos.stock': 'Stock',
  'pos.retail': 'Détail',
  'pos.wholesale': 'Gros',

  'checkout.cash': 'Espèces',
  'checkout.momo': 'Mobile money / carte',
  'checkout.split': 'Paiement mixte',
  'checkout.total': 'Total',
  'checkout.subtotal': 'Sous-total',
  'checkout.discount': 'Remise',
  'checkout.pay': 'Payer',
  'checkout.success': 'Vente terminée',
  'checkout.downloadPdf': 'Télécharger le PDF',
  'checkout.share': 'Partager',
  'checkout.print': 'Imprimer',
  'checkout.whatsapp': 'WhatsApp',
  'checkout.newSale': 'Nouvelle vente',

  'sales.title': 'Ventes',
  'sales.myTitle': 'Mes ventes',
  'expenses.title': 'Dépenses',
  'cashbook.title': 'Livre de caisse',
  'cashbook.ledger': 'Grand livre',
  'cashbook.statements': 'États financiers',
  'cashbook.income': 'Recette',
  'cashbook.expense': 'Dépense',
  'cashbook.cat.cashSales': 'Ventes en espèces',
  'cashbook.cat.capital': 'Capital',
  'cashbook.cat.loan': 'Prêt',
  'cashbook.cat.refund': 'Remboursement',
  'cashbook.cat.other': 'Autre',
  'cashbook.cat.rent': 'Loyer',
  'cashbook.cat.utilities': 'Charges',
  'cashbook.cat.supplier': 'Fournisseur',
  'cashbook.cat.salaries': 'Salaires',
  'cashbook.cat.transport': 'Transport',
  'cashbook.cat.withdrawal': 'Prélèvement',
  'reports.title': 'Rapports et analyses',
  'inventory.title': 'Stock',
  'devices.title': 'Appareils',
  'plan.title': 'Abonnement',
  'warehouse.title': 'Entrepôt',
  'online.title': 'Boutique en ligne',

  'blocked.cashierTitle': 'Compte bloqué',
  'blocked.storeTitle': 'Accès à la boutique suspendu',
};

const catalogs: Record<AppLanguage, Record<string, string>> = { en, fr };

function isLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'fr';
}

function readStoredLanguage(): AppLanguage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistLanguage(language: AppLanguage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'fr' ? 'fr' : 'en';
  } catch {
    // Ignore quota / private mode
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined || vars[key] === null ? `{${key}}` : String(vars[key])
  );
}

export function translate(
  language: AppLanguage,
  key: string,
  vars?: Record<string, string | number>
): string {
  const text = catalogs[language][key] || catalogs.en[key] || key;
  return interpolate(text, vars);
}

interface I18nState {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  language: readStoredLanguage() || 'en',
  setLanguage: (language) => {
    persistLanguage(language);
    set({ language });
  },
}));

/** Apply a store's default language only when this device has no saved choice. */
export function applyStoreLanguageDefault(preferred?: string | null): void {
  if (readStoredLanguage()) return;
  if (!isLanguage(preferred)) return;
  useI18nStore.getState().setLanguage(preferred);
}

export function hasStoredLanguage(): boolean {
  return readStoredLanguage() !== null;
}

export function tNow(key: string, vars?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().language, key, vars);
}

export function useT() {
  const language = useI18nStore((s) => s.language);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language]
  );
}

export const CASHBOOK_INCOME_STORED = ['Cash sales', 'Capital', 'Loan', 'Refund', 'Other'] as const;
export const CASHBOOK_EXPENSE_STORED = [
  'Rent',
  'Utilities',
  'Supplier',
  'Salaries',
  'Transport',
  'Withdrawal',
  'Other',
] as const;

const CASHBOOK_CAT_KEYS: Record<string, string> = {
  'Cash sales': 'cashbook.cat.cashSales',
  Capital: 'cashbook.cat.capital',
  Loan: 'cashbook.cat.loan',
  Refund: 'cashbook.cat.refund',
  Other: 'cashbook.cat.other',
  Rent: 'cashbook.cat.rent',
  Utilities: 'cashbook.cat.utilities',
  Supplier: 'cashbook.cat.supplier',
  Salaries: 'cashbook.cat.salaries',
  Transport: 'cashbook.cat.transport',
  Withdrawal: 'cashbook.cat.withdrawal',
};

export function cashbookCategoryLabel(stored: string, t: (key: string) => string): string {
  const key = CASHBOOK_CAT_KEYS[stored];
  return key ? t(key) : stored;
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = (readStoredLanguage() || 'en') === 'fr' ? 'fr' : 'en';
}
