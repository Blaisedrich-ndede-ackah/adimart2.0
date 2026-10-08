import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCampaignAdminSessionToken } from '@/lib/adminAuth';

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

export function getCampaignAdminAccess(): CampaignAdminAccess {
  if (!isSupabaseConfigured()) return 'unconfigured';
  return getCampaignAdminSessionToken() ? 'authorized' : 'signed-out';
}

async function invokeCampaignAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const sessionToken = getCampaignAdminSessionToken();
  if (!sessionToken) throw new Error('Admin session expired. Sign in to the admin portal again.');
  const { data, error } = await supabase.functions.invoke('campaign-admin', {
    body: { ...body, sessionToken },
  });
  if (error) {
    const context = (error as Error & { context?: Response }).context;
    const responseBody = context ? await context.clone().json().catch(() => null) as { error?: string } | null : null;
    throw new Error(responseBody?.error || error.message || 'Campaign request could not be completed.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
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
  throw new Error(campaignErrorMessage(error));
}

export async function fetchActiveCampaigns(): Promise<PromotionCampaign[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('promotional_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throwQueryError(error);

  const now = Date.now();
  return ((data || []) as unknown as CampaignRow[])
    .filter((campaign) => {
      const startsAt = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
      const endsAt = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
      return (
        (startsAt === null || (Number.isFinite(startsAt) && startsAt <= now)) &&
        (endsAt === null || (Number.isFinite(endsAt) && endsAt > now))
      );
    })
    .map(presentCampaign);
}

export async function fetchAdminCampaigns(): Promise<PromotionCampaign[]> {
  await requireCampaignAdmin();
  return invokeCampaignAdmin<PromotionCampaign[]>({ action: 'list' });
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
  if (!getCampaignAdminSessionToken()) throw new Error('Admin session expired. Sign in to the admin portal again.');
}

async function uploadCampaignMedia(file: File): Promise<string> {
  await requireCampaignAdmin();
  const validationError = validateCampaignMedia(file);
  if (validationError) throw new Error(validationError);
  const upload = await invokeCampaignAdmin<{ path: string; token: string }>({
    action: 'create-upload',
    mimeType: file.type,
  });
  const { error } = await supabase.storage.from(CAMPAIGN_BUCKET).uploadToSignedUrl(
    upload.path,
    upload.token,
    file,
    { cacheControl: '3600', contentType: file.type },
  );
  if (error) throw new Error(campaignErrorMessage(error));
  return upload.path;
}

async function quietlyRemoveMedia(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return;
  await invokeCampaignAdmin({ action: 'remove-media', paths: uniquePaths });
}

export async function createPromotionCampaign(
  fields: CampaignFields,
  file: File
): Promise<PromotionCampaign> {
  await requireCampaignAdmin();
  const mediaPath = await uploadCampaignMedia(file);
  return invokeCampaignAdmin<PromotionCampaign>({
    action: 'create', fields, mediaPath, mimeType: file.type,
  });
}

export async function updatePromotionCampaign(
  campaign: PromotionCampaign,
  fields: Partial<CampaignFields>,
  replacementFile?: File | null
): Promise<{ campaign: PromotionCampaign; cleanupWarning: string }> {
  await requireCampaignAdmin();
  const mediaPath = replacementFile ? await uploadCampaignMedia(replacementFile) : '';
  return invokeCampaignAdmin({
    action: 'update',
    id: campaign.id,
    fields,
    ...(mediaPath ? { mediaPath, mimeType: replacementFile?.type } : {}),
  });
}

export async function deletePromotionCampaign(
  campaign: PromotionCampaign
): Promise<string> {
  await requireCampaignAdmin();
  const result = await invokeCampaignAdmin<{ cleanupWarning: string }>({ action: 'delete', id: campaign.id });
  return result.cleanupWarning;
}

export async function uploadCampaignAdminMedia(file: File): Promise<string> {
  return uploadCampaignMedia(file);
}

export async function requireCampaignAdminAccess(): Promise<void> {
  await requireCampaignAdmin();
}

export async function removeCampaignMedia(paths: string[]): Promise<void> {
  await requireCampaignAdmin();
  await quietlyRemoveMedia(paths);
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
