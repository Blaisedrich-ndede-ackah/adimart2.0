import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'promotional-campaigns';
const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const CAMPAIGN_COLUMNS =
  'id,title,description,media_type,media_path,poster_path,alt_text,cta_label,cta_url,is_published,starts_at,ends_at,sort_order,created_at,updated_at';
const MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const CAMPAIGN_FIELDS = [
  'title',
  'description',
  'alt_text',
  'cta_label',
  'cta_url',
  'is_published',
  'starts_at',
  'ends_at',
  'sort_order',
] as const;

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function database() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project environment.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pinMatches(submitted: string, configured: string): boolean {
  const submittedBytes = Buffer.from(submitted.trim());
  const configuredBytes = Buffer.from(configured.trim());
  return submittedBytes.length === configuredBytes.length &&
    timingSafeEqual(submittedBytes, configuredBytes);
}

function clientIp(request: ApiRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

async function validateSession(db: ReturnType<typeof database>, token: unknown): Promise<string> {
  if (typeof token !== 'string' || token.length < 40) {
    throw new Error('Admin session expired. Sign in with the administrator PIN again.');
  }
  const sessionHash = hash(token);
  const { data, error } = await db
    .from('promotional_campaign_admin_sessions')
    .select('session_hash')
    .eq('session_hash', sessionHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Admin session expired. Sign in with the administrator PIN again.');
  return sessionHash;
}

function validateFields(value: unknown, partial = false): Record<string, unknown> {
  const input = objectBody(value);
  const fields: Record<string, unknown> = {};
  for (const name of CAMPAIGN_FIELDS) {
    if (name in input) fields[name] = input[name];
    else if (!partial) {
      if (name === 'description' || name === 'alt_text' || name === 'cta_label' || name === 'cta_url') fields[name] = '';
      else if (name === 'is_published') fields[name] = false;
      else if (name === 'starts_at' || name === 'ends_at') fields[name] = null;
      else if (name === 'sort_order') fields[name] = 0;
    }
  }
  if ((!partial || 'title' in fields) &&
      (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 160)) {
    throw new Error('Campaign title is required and must be 160 characters or fewer.');
  }
  if ('is_published' in fields && typeof fields.is_published !== 'boolean') {
    throw new Error('Campaign publish status is invalid.');
  }
  if ('sort_order' in fields && !Number.isSafeInteger(fields.sort_order)) {
    throw new Error('Campaign display order must be a whole number.');
  }
  for (const name of ['description', 'alt_text', 'cta_label', 'cta_url'] as const) {
    if (name in fields && typeof fields[name] !== 'string') throw new Error(`Campaign ${name} is invalid.`);
  }
  for (const name of ['starts_at', 'ends_at'] as const) {
    if (name in fields && fields[name] !== null &&
        (typeof fields[name] !== 'string' || !Number.isFinite(Date.parse(fields[name])))) {
      throw new Error(`Campaign ${name} date is invalid.`);
    }
  }
  const startsAt = fields.starts_at ? Date.parse(String(fields.starts_at)) : null;
  const endsAt = fields.ends_at ? Date.parse(String(fields.ends_at)) : null;
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
    throw new Error('The campaign end date must be later than its start date.');
  }
  return fields;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const body = objectBody(request.body);
    const action = requiredString(body.action, 'Action');
    const db = database();

    if (action === 'login') {
      const adminPin = process.env.VITE_ADMIN_PIN;
      if (!adminPin) throw new Error('The admin PIN is not configured in Vercel as VITE_ADMIN_PIN.');

      const ipHash = hash(clientIp(request));
      const now = Date.now();
      const { data: attempts, error: readError } = await db
        .from('promotional_campaign_login_attempts')
        .select('failed_attempts,window_started_at,locked_until')
        .eq('ip_hash', ipHash)
        .maybeSingle();
      if (readError) throw readError;
      if (attempts?.locked_until && Date.parse(attempts.locked_until) > now) {
        response.status(429).json({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' });
        return;
      }
      if (typeof body.pin !== 'string' || !pinMatches(body.pin, adminPin)) {
        const windowStartedAt = attempts?.window_started_at ? Date.parse(attempts.window_started_at) : 0;
        const withinWindow = Number.isFinite(windowStartedAt) && now - windowStartedAt < LOGIN_WINDOW_MS;
        const failedAttempts = withinWindow ? Number(attempts?.failed_attempts || 0) + 1 : 1;
        const { error } = await db.from('promotional_campaign_login_attempts').upsert({
          ip_hash: ipHash,
          failed_attempts: failedAttempts,
          window_started_at: withinWindow && attempts
            ? attempts.window_started_at
            : new Date(now).toISOString(),
          locked_until: failedAttempts >= MAX_LOGIN_ATTEMPTS
            ? new Date(now + LOGIN_LOCK_MS).toISOString()
            : null,
        });
        if (error) throw error;
        response.status(failedAttempts >= MAX_LOGIN_ATTEMPTS ? 429 : 401).json({
          error: failedAttempts >= MAX_LOGIN_ATTEMPTS
            ? 'Too many incorrect PIN attempts. Try again in 15 minutes.'
            : 'Invalid administrator PIN.',
        });
        return;
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now + TOKEN_LIFETIME_MS).toISOString();
      const { error: expiredSessionError } = await db
        .from('promotional_campaign_admin_sessions')
        .delete()
        .lt('expires_at', new Date(now).toISOString());
      if (expiredSessionError) throw expiredSessionError;
      const { error: sessionError } = await db.from('promotional_campaign_admin_sessions').insert({
        session_hash: hash(token),
        expires_at: expiresAt,
      });
      if (sessionError) throw sessionError;
      const { error: clearError } = await db
        .from('promotional_campaign_login_attempts')
        .delete()
        .eq('ip_hash', ipHash);
      if (clearError) throw clearError;
      response.status(200).json({ session: token });
      return;
    }

    if (action === 'verify-session') {
      await validateSession(db, body.session);
      response.status(200).json({ success: true });
      return;
    }

    if (action === 'logout') {
      if (typeof body.session === 'string') {
        const { error } = await db
          .from('promotional_campaign_admin_sessions')
          .delete()
          .eq('session_hash', hash(body.session));
        if (error) throw error;
      }
      response.status(200).json({ success: true });
      return;
    }

    await validateSession(db, body.session);

    if (action === 'list') {
      const { data, error } = await db
        .from('promotional_campaigns')
        .select(CAMPAIGN_COLUMNS)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      response.status(200).json({ campaigns: data || [] });
      return;
    }

    if (action === 'create-upload-url') {
      const contentType = requiredString(body.contentType, 'Media type');
      if (!MEDIA_TYPES.has(contentType)) throw new Error('Choose a supported image or video format.');
      const extension = contentType.split('/')[1].replace('jpeg', 'jpg').replace('quicktime', 'mov');
      const path = `${randomBytes(16).toString('hex')}.${extension}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      response.status(200).json({ path: data.path, token: data.token });
      return;
    }

    if (action === 'create') {
      const fields = validateFields(body.fields);
      const mediaPath = requiredString(body.mediaPath, 'Campaign media');
      const mediaType = requiredString(body.mediaType, 'Media type');
      if (!MEDIA_TYPES.has(mediaType)) throw new Error('Campaign media is unsupported.');
      const { data, error } = await db
        .from('promotional_campaigns')
        .insert({
          ...fields,
          media_type: mediaType.startsWith('video/') ? 'video' : 'image',
          media_path: mediaPath,
        })
        .select(CAMPAIGN_COLUMNS)
        .single();
      if (error) throw error;
      response.status(200).json({ campaign: data });
      return;
    }

    if (action === 'update') {
      const id = requiredString(body.id, 'Campaign ID');
      const fields = validateFields(body.fields, true);
      if (typeof body.mediaPath === 'string' && body.mediaPath) {
        const mediaType = requiredString(body.mediaType, 'Media type');
        if (!MEDIA_TYPES.has(mediaType)) throw new Error('Replacement media is unsupported.');
        fields.media_path = body.mediaPath;
        fields.media_type = mediaType.startsWith('video/') ? 'video' : 'image';
        fields.poster_path = null;
      }
      const { data, error } = await db
        .from('promotional_campaigns')
        .update(fields)
        .eq('id', id)
        .select(CAMPAIGN_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Campaign not found.');
      response.status(200).json({ campaign: data });
      return;
    }

    if (action === 'delete') {
      const id = requiredString(body.id, 'Campaign ID');
      const { data, error } = await db
        .from('promotional_campaigns')
        .delete()
        .eq('id', id)
        .select('media_path,poster_path')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Campaign not found.');
      const paths = [data.media_path, data.poster_path].filter((path): path is string => Boolean(path));
      let cleanupWarning = '';
      if (paths.length) {
        const { error: cleanupError } = await db.storage.from(BUCKET).remove(paths);
        if (cleanupError) cleanupWarning = `Campaign deleted, but media cleanup failed: ${cleanupError.message}`;
      }
      response.status(200).json({ success: true, cleanupWarning });
      return;
    }

    if (action === 'remove-media') {
      const paths = Array.isArray(body.paths)
        ? body.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
        : [];
      if (paths.length) {
        const { error } = await db.storage.from(BUCKET).remove(paths);
        if (error) throw error;
      }
      response.status(200).json({ success: true });
      return;
    }

    response.status(400).json({ error: 'Unknown campaign action.' });
  } catch (error) {
    console.error('Campaign API request failed:', error);
    const status = error instanceof Error && error.message.startsWith('Admin session expired') ? 401 : 400;
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Campaign request failed.',
    });
  }
}
