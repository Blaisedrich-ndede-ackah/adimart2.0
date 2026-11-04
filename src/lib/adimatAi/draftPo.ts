export const DRAFT_PO_KEY = 'adimat-ai-po-draft';

export interface DraftPoLine {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

export interface DraftPurchaseOrder {
  supplierId: string;
  supplierName: string;
  notes: string;
  lines: DraftPoLine[];
  createdAt: string;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): DraftStorage | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

export function saveDraftPurchaseOrder(draft: DraftPurchaseOrder, storage?: DraftStorage | null): void {
  const target = storage === undefined ? browserStorage() : storage;
  target?.setItem(DRAFT_PO_KEY, JSON.stringify(draft));
}

export function peekDraftPurchaseOrder(storage?: DraftStorage | null): DraftPurchaseOrder | null {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return null;
  try {
    const raw = target.getItem(DRAFT_PO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPurchaseOrder;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the draft once. Purchasing uses this so a refresh does not recreate it. */
export function takeDraftPurchaseOrder(storage?: DraftStorage | null): DraftPurchaseOrder | null {
  const target = storage === undefined ? browserStorage() : storage;
  const draft = peekDraftPurchaseOrder(target);
  target?.removeItem(DRAFT_PO_KEY);
  return draft;
}
