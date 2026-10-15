import { db, type LocalUser } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type PosSection = 'scanner' | 'frequent' | 'products' | 'cart';
export type PosLayout = {
  topOrder: ('scanner' | 'frequent')[];
  paneOrder: ('products' | 'cart')[];
};

export const DEFAULT_POS_LAYOUT: PosLayout = {
  topOrder: ['scanner', 'frequent'],
  paneOrder: ['products', 'cart'],
};

function parseOrder<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value) || value.length !== allowed.length) return null;
  if (!value.every((item): item is T => typeof item === 'string' && allowed.includes(item as T))) return null;
  if (new Set(value).size !== allowed.length) return null;
  return [...value];
}

export function parsePosLayout(value?: string | null): PosLayout {
  if (!value) return DEFAULT_POS_LAYOUT;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_POS_LAYOUT;
    const layout = parsed as Record<string, unknown>;
    const topOrder = parseOrder(layout.topOrder, ['scanner', 'frequent'] as const);
    const paneOrder = parseOrder(layout.paneOrder, ['products', 'cart'] as const);
    return topOrder && paneOrder ? { topOrder, paneOrder } : DEFAULT_POS_LAYOUT;
  } catch {
    return DEFAULT_POS_LAYOUT;
  }
}

export async function loadOwnerPosLayout(ownerId: string): Promise<{
  layout: PosLayout;
  cloudError?: string;
}> {
  const owner = await db.users.get(ownerId);
  if (!owner || owner.role !== 'owner') {
    throw new Error('The store owner account could not be found on this device.');
  }

  const localLayout = parsePosLayout(owner.pos_layout_json);
  if (!isSupabaseConfigured()) return { layout: localLayout };

  const { data, error } = await supabase
    .from('users')
    .select('pos_layout_json')
    .eq('id', ownerId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error) return { layout: localLayout, cloudError: error.message };
  if (!data?.pos_layout_json) return { layout: localLayout };

  const layout = parsePosLayout(String(data.pos_layout_json));
  await db.users.update(ownerId, { pos_layout_json: JSON.stringify(layout) });
  return { layout };
}

export async function saveOwnerPosLayout(owner: LocalUser, layout: PosLayout): Promise<{
  cloudSaved: boolean;
  message: string;
}> {
  if (owner.role !== 'owner') {
    throw new Error('Only the store owner can change the POS layout.');
  }

  const serialized = JSON.stringify(layout);
  const current = await db.users.get(owner.id);
  if (!current || current.role !== 'owner') {
    throw new Error('The store owner account could not be found on this device.');
  }

  await db.users.update(owner.id, { pos_layout_json: serialized, synced: 0 });
  if (!isSupabaseConfigured()) {
    return { cloudSaved: false, message: 'Saved on this device. Cloud sync is not configured.' };
  }

  const { data, error } = await supabase
    .from('users')
    .update({ pos_layout_json: serialized })
    .eq('id', owner.id)
    .eq('role', 'owner')
    .select('id')
    .maybeSingle();

  if (error) {
    return { cloudSaved: false, message: `Saved on this device, but cloud save failed: ${error.message}` };
  }
  if (!data) {
    return { cloudSaved: false, message: 'Saved on this device, but the owner account was not found in the cloud.' };
  }

  await db.users.update(owner.id, { synced: current.synced });
  return { cloudSaved: true, message: 'Layout saved to the owner account.' };
}
