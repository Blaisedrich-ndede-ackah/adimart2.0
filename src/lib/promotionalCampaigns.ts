import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  adminFunctionErrorMessage,
  getAdminSessionToken,
  isAdminSessionActive,
} from '@/lib/adminAuth';
import { db, type CachedCampaigns } from '@/lib/dexie';

export const CAMPAIGN_BUCKET = 'promotional-campaigns';
export const PUBLIC_CAMPAIGNS_KEY = 'promotional-campaigns:public-active';
export const CAMPAIGN_ADMIN_STATUS_KEY = 'promotional-campaigns:admin-status';
export const CAMPAIGN_ADMIN_LIST_KEY = 'promotional-campaigns:admin-list';
export const CAMPAIGN_MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const CAMPAIGN_COLUMNS =
  'id,title,description,media_type,media_path,poster_path,alt_text,cta_label,cta_url,is_published,starts_at,ends_at,sort_order,created_at,updated_at';

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const PUBLIC_CAMPAIGN_CACHE_ID = 'public-active';
const PUBLIC_CAMPAIGN_MEDIA_CACHE = 'adimat-campaign-media-v1';
const OFFLINE_MEDIA_URLS = new Map<string, string>();

export type CampaignMediaType = 'image' | 'video';

export interface CampaignRow {
  id: string;
  title: string;
  description: string;
  media_type: CampaignMediaType;
  media_path: string;
  poster_path: string | null;
  alt_text: string;
  cta_label: string;
  cta_url: string;
  is_published: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PromotionCampaign extends CampaignRow {
  media_url: string;
  poster_url: string | null;
}

export type CampaignFields = Pick<
  CampaignRow,
  | 'title'
  | 'description'
  | 'alt_text'
  | 'cta_label'
  | 'cta_url'
  | 'is_published'
  | 'starts_at'
  | 'ends_at'
  | 'sort_order'
>;

export type CampaignAdminAccess = 'unconfigured' | 'signed-out' | 'not-authorized' | 'authorized';

export async function getCampaignAdminAccess(): Promise<CampaignAdminAccess> {
  if (!isSupabaseConfigured()) return 'unconfigured';
  if (!isAdminSessionActive()) return 'signed-out';
  await invokeCampaignAdmin('verify-session');
  return 'authorized';
}

function presentCampaign(row: CampaignRow): PromotionCampaign {
  const storage = supabase.storage.from(CAMPAIGN_BUCKET);
  return {
    ...row,
    media_url: storage.getPublicUrl(row.media_path).data.publicUrl,
    poster_url: row.poster_path ? storage.getPublicUrl(row.poster_path).data.publicUrl : null,
  };
}

function throwQueryError(error: unknown): never {
  throw new Error(adminFunctionErrorMessage(error));
}

export async function fetchActiveCampaigns(): Promise<PromotionCampaign[]> {
  if (!isSupabaseConfigured()) return readOfflineCampaigns();
  try {
    const { data, error } = await supabase
      .from('promotional_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .eq('is_published', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throwQueryError(error);

    const now = Date.now();
    const campaigns = ((data || []) as unknown as CampaignRow[])
      .filter((campaign) => {
        const startsAt = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
        const endsAt = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
        return (
          (startsAt === null || (Number.isFinite(startsAt) && startsAt <= now)) &&
          (endsAt === null || (Number.isFinite(endsAt) && endsAt > now))
        );
      })
      .map(presentCampaign);

    try {
      await cachePublicCampaigns(campaigns);
    } catch (cacheError) {
      console.warn('Could not save campaigns for offline viewing:', cacheError);
    }
    void cacheCampaignMedia(campaigns);
    return campaigns;
  } catch (error) {
    const cachedCampaigns = await readOfflineCampaigns();
    if (cachedCampaigns.length) return cachedCampaigns;
    throw error;
  }
}

export async function fetchAdminCampaigns(): Promise<PromotionCampaign[]> {
  const response = await invokeCampaignAdmin<{ campaigns: CampaignRow[] }>('list');
  return (response.campaigns || []).map(presentCampaign);
}

async function invokeCampaignAdmin<T>(
  action: string,
  values: Record<string, unknown> = {}
): Promise<T> {
  const session = getAdminSessionToken();
  if (!session) throw new Error('Admin session expired. Sign in to the administrator portal again.');
  let response: Response;
  try {
    response = await fetch('/api/manage-promotional-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, session, ...values }),
    });
  } catch {
    throw new Error('Could not reach the Vercel admin API. Confirm this app is deployed on Vercel and check the internet connection.');
  }
  let data: (T & { error?: string }) | null = null;
  try {
    data = await response.json() as T & { error?: string };
  } catch {
    data = null;
  }
  if (!response.ok) {
    const routeHint = response.status === 404
      ? ' The /api/manage-promotional-campaigns route is missing; redeploy the latest version on Vercel.'
      : '';
    throw new Error(data?.error || `Campaign API request failed (${response.status}).${routeHint}`);
  }
  if (!data) throw new Error('The campaign service returned no response.');
  if (typeof data === 'object' && data !== null && 'error' in data && data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function cachePublicCampaigns(campaigns: PromotionCampaign[]): Promise<void> {
  await db.campaign_cache.put({
    id: PUBLIC_CAMPAIGN_CACHE_ID,
    campaigns: campaigns as unknown as Array<Record<string, unknown>>,
    updated_at: new Date().toISOString(),
  });
}

async function readOfflineCampaigns(): Promise<PromotionCampaign[]> {
  const cached = await db.campaign_cache.get(PUBLIC_CAMPAIGN_CACHE_ID) as CachedCampaigns | undefined;
  if (!cached) return [];
  const now = Date.now();
  const campaigns = (cached.campaigns as unknown as PromotionCampaign[]).filter((campaign) => {
    const startsAt = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
    const endsAt = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
    return (
      (startsAt === null || (Number.isFinite(startsAt) && startsAt <= now)) &&
      (endsAt === null || (Number.isFinite(endsAt) && endsAt > now))
    );
  });
  const mediaCache = typeof caches === 'undefined'
    ? null
    : await caches.open(PUBLIC_CAMPAIGN_MEDIA_CACHE).catch(() => null);
  return Promise.all(campaigns.map(async (campaign) => {
    if (!mediaCache) return campaign;
    const offlineUrl = async (url: string | null): Promise<string | null> => {
      if (!url) return null;
      const existingUrl = OFFLINE_MEDIA_URLS.get(url);
      if (existingUrl) return existingUrl;
      const response = await mediaCache.match(url);
      if (!response) return url;
      const localUrl = URL.createObjectURL(await response.blob());
      OFFLINE_MEDIA_URLS.set(url, localUrl);
      return localUrl;
    };
    const [mediaUrl, posterUrl] = await Promise.all([
      offlineUrl(campaign.media_url),
      offlineUrl(campaign.poster_url),
    ]);
    return {
      ...campaign,
      media_url: mediaUrl || campaign.media_url,
      poster_url: posterUrl,
    };
  }));
}

async function cacheCampaignMedia(campaigns: PromotionCampaign[]): Promise<void> {
  if (typeof caches === 'undefined' || typeof fetch === 'undefined') return;
  try {
    const cache = await caches.open(PUBLIC_CAMPAIGN_MEDIA_CACHE);
    const urls = campaigns.flatMap((campaign) =>
      [campaign.media_url, campaign.poster_url].filter((value): value is string => Boolean(value))
    );
    let cursor = 0;
    const cacheNextMedia = async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        try {
          if (await cache.match(url)) continue;
          const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (response.ok && response.type !== 'opaque') await cache.put(url, response);
        } catch (error) {
          console.warn('Could not cache campaign media for offline viewing:', error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, urls.length) }, cacheNextMedia));
    const keepUrls = new Set(urls);
    await Promise.all((await cache.keys())
      .filter((request) => !keepUrls.has(request.url))
      .map((request) => cache.delete(request)));
  } catch (error) {
    console.warn('Could not open campaign media cache for offline viewing:', error);
  }
}

export function validateCampaignMedia(file: File): string | null {
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
    return 'Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.';
  }
  if (file.size === 0) return 'This file is empty. Choose another media file.';
  if (file.size > CAMPAIGN_MAX_MEDIA_BYTES) return 'The file must be 50 MB or smaller.';
  return null;
}

export function normalizeCampaignCtaUrl(value: string): string {
  const input = value.trim();
  if (!input) return '';

  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Campaign links must use HTTP or HTTPS.');
  }
  return url.toString();
}

export function safeCampaignCtaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function isCampaignMigrationMissing(error: unknown): boolean {
  const { code, message } = describeError(error);
  const normalized = message.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    normalized.includes('promotional_campaigns') &&
      (normalized.includes('does not exist') || normalized.includes('schema cache'))
  );
}

export function campaignErrorMessage(error: unknown): string {
  if (isCampaignMigrationMissing(error)) {
    return 'The campaign database migration has not been applied yet. This page does not run SQL or change your Supabase project.';
  }

  const { message } = describeError(error);
  if (message.includes('Load failed') || message.includes('Failed to fetch')) {
    return 'Could not reach Supabase. Check the connection and try again.';
  }
  if (/api\/manage-promotional-campaigns/i.test(message) && /not found|404/i.test(message)) {
    return 'Campaign tools need the Vercel API route at /api/manage-promotional-campaigns. Redeploy the latest app from Vercel.';
  }
  return message || 'The campaign request could not be completed.';
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const databaseError = error as Error & { code?: string };
    return { code: databaseError.code || '', message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : '',
      message: typeof value.message === 'string' ? value.message : '',
    };
  }
  return { code: '', message: typeof error === 'string' ? error : '' };
}

async function requireCampaignAdmin(): Promise<void> {
  if (!isAdminSessionActive()) throw new Error('Admin session expired. Sign in to the admin portal again.');
  await invokeCampaignAdmin('verify-session');
}

async function uploadCampaignMedia(file: File): Promise<string> {
  await requireCampaignAdmin();
  const validationError = validateCampaignMedia(file);
  if (validationError) throw new Error(validationError);
  const { path, token } = await invokeCampaignAdmin<{ path: string; token: string }>(
    'create-upload-url',
    { contentType: file.type }
  );
  const { error } = await supabase.storage.from(CAMPAIGN_BUCKET).uploadToSignedUrl(
    path,
    token,
    file,
    { cacheControl: '3600', contentType: file.type, upsert: false },
  );
  if (error) {
    const cleanupWarning = await removeMedia([path]);
    throw new Error([campaignErrorMessage(error), cleanupWarning].filter(Boolean).join(' '));
  }
  return path;
}

async function removeMedia(paths: string[]): Promise<string> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return '';
  try {
    await invokeCampaignAdmin('remove-media', { paths: uniquePaths });
    return '';
  } catch (error) {
    return `Campaign media cleanup failed: ${campaignErrorMessage(error)}`;
  }
}

export async function createPromotionCampaign(
  fields: CampaignFields,
  file: File
): Promise<PromotionCampaign> {
  await requireCampaignAdmin();
  const mediaPath = await uploadCampaignMedia(file);
  try {
    const { campaign } = await invokeCampaignAdmin<{ campaign: CampaignRow }>('create', {
      fields,
      mediaPath,
      mediaType: file.type,
    });
    return presentCampaign(campaign);
  } catch (error) {
    const cleanupWarning = await removeMedia([mediaPath]);
    throw new Error([campaignErrorMessage(error), cleanupWarning].filter(Boolean).join(' '));
  }
}

export async function updatePromotionCampaign(
  campaign: PromotionCampaign,
  fields: Partial<CampaignFields>,
  replacementFile?: File | null
): Promise<{ campaign: PromotionCampaign; cleanupWarning: string }> {
  await requireCampaignAdmin();
  const replacementPath = replacementFile ? await uploadCampaignMedia(replacementFile) : '';
  let savedCampaign: CampaignRow;
  try {
    const result = await invokeCampaignAdmin<{ campaign: CampaignRow }>('update', {
      id: campaign.id,
      fields,
      ...(replacementPath && replacementFile
        ? { mediaPath: replacementPath, mediaType: replacementFile.type }
        : {}),
    });
    savedCampaign = result.campaign;
  } catch (error) {
    const cleanupWarning = replacementPath ? await removeMedia([replacementPath]) : '';
    throw new Error([campaignErrorMessage(error), cleanupWarning].filter(Boolean).join(' '));
  }

  const cleanupWarning = replacementPath
    ? await removeMedia([campaign.media_path, campaign.poster_path || ''])
    : '';
  return { campaign: presentCampaign(savedCampaign), cleanupWarning };
}

export async function deletePromotionCampaign(
  campaign: PromotionCampaign
): Promise<string> {
  await requireCampaignAdmin();
  const result = await invokeCampaignAdmin<{ cleanupWarning?: string }>('delete', { id: campaign.id });
  return result.cleanupWarning || '';
}

export async function uploadCampaignAdminMedia(file: File): Promise<string> {
  return uploadCampaignMedia(file);
}

export async function requireCampaignAdminAccess(): Promise<void> {
  await requireCampaignAdmin();
}

export async function removeCampaignMedia(paths: string[]): Promise<void> {
  await requireCampaignAdmin();
  const warning = await removeMedia(paths);
  if (warning) throw new Error(warning);
}

export function campaignPublicMedia(path: string): string {
  return supabase.storage.from(CAMPAIGN_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function campaignPosterMedia(path: string | null): string | null {
  return path ? supabase.storage.from(CAMPAIGN_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

export function campaignMediaTypeLabel(type: CampaignMediaType): string {
  return type === 'video' ? 'Video' : 'Flyer';
}

export function campaignStatusLabel(campaign: PromotionCampaign): string {
  if (!campaign.is_published) return 'Draft';
  const now = Date.now();
  if (campaign.starts_at && Date.parse(campaign.starts_at) > now) return 'Scheduled';
  if (campaign.ends_at && Date.parse(campaign.ends_at) <= now) return 'Ended';
  return 'Published';
}

export function formatCampaignDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function datetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function validateCampaignDateWindow(startsAt: string, endsAt: string): string | null {
  if (startsAt && !datetimeLocalToIso(startsAt)) return 'Enter a valid campaign start date.';
  if (endsAt && !datetimeLocalToIso(endsAt)) return 'Enter a valid campaign end date.';
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return 'The end date must be later than the start date.';
  }
  return null;
}

export function mediaFileType(file: File): CampaignMediaType {
  return file.type.startsWith('video/') ? 'video' : 'image';
}

export const PROMOTIONAL_CAMPAIGN_MIGRATION_FILE = 'supabase-migrate-promotional-campaigns.sql';

export const isConfiguredForCampaigns = isSupabaseConfigured;
