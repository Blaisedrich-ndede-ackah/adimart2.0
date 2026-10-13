import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'promotional-campaigns';
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const CAMPAIGN_COLUMNS =
  'id,title,description,media_type,media_path,poster_path,alt_text,cta_label,cta_url,is_published,starts_at,ends_at,sort_order,created_at,updated_at';
const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const encoder = new TextEncoder();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('ADMIN_SESSION_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be configured with at least 32 characters.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createAdminSession(): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function requestKey(request: Request): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const digest = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(`login:${address}`));
  return base64UrlEncode(new Uint8Array(digest));
}

async function isValidAdminSession(token: unknown): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length > 0) return false;
  try {
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await signingKey(),
      base64UrlDecode(signature),
      encoder.encode(payload),
    );
    if (!validSignature) return false;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return Number.isInteger(claims.exp) && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('Supabase function service credentials are not configured.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function validateCampaignFields(value: unknown, partial = false): Record<string, unknown> {
  const fields = objectBody(value);
  const result: Record<string, unknown> = {};
  for (const name of CAMPAIGN_FIELDS) {
    if (!(name in fields)) {
      if (partial) continue;
      if (name === 'description' || name === 'alt_text' || name === 'cta_label' || name === 'cta_url') {
        result[name] = '';
      } else if (name === 'is_published') {
        result[name] = false;
      } else if (name === 'starts_at' || name === 'ends_at') {
        result[name] = null;
      } else if (name === 'sort_order') {
        result[name] = 0;
      }
      continue;
    }
    result[name] = fields[name];
  }
  if ((!partial || 'title' in result) &&
      (typeof result.title !== 'string' || !result.title.trim() || result.title.length > 160)) {
    throw new Error('Campaign title is required and must be 160 characters or fewer.');
  }
  if ('is_published' in result && typeof result.is_published !== 'boolean') {
    throw new Error('Campaign publish status is invalid.');
  }
  if ('sort_order' in result && !Number.isSafeInteger(result.sort_order)) {
    throw new Error('Campaign display order must be a whole number.');
  }
  for (const name of ['description', 'alt_text', 'cta_label', 'cta_url'] as const) {
    if (name in result && typeof result[name] !== 'string') throw new Error(`Campaign ${name} is invalid.`);
  }
  for (const name of ['starts_at', 'ends_at'] as const) {
    if (name in result && result[name] !== null &&
        (typeof result[name] !== 'string' || !Number.isFinite(Date.parse(String(result[name]))))) {
      throw new Error(`Campaign ${name} date is invalid.`);
    }
  }
  const startsAt = result.starts_at ? Date.parse(String(result.starts_at)) : null;
  const endsAt = result.ends_at ? Date.parse(String(result.ends_at)) : null;
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
    throw new Error('The campaign end date must be later than its start date.');
  }
  return result;
}

async function requireSession(body: Record<string, unknown>): Promise<void> {
  if (!(await isValidAdminSession(body.session))) {
    throw new Response('Administrator session expired. Sign in with the administrator PIN again.', { status: 401 });
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = objectBody(await request.json());
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400);
  }

  try {
    const action = body.action;
    if (action === 'login') {
      const configuredPin = Deno.env.get('ADMIN_PIN');
      if (!configuredPin) throw new Error('ADMIN_PIN has not been configured for the campaign function.');
      const supabase = serviceClient();
      const ipHash = await requestKey(request);
      const now = Date.now();
      const { data: attempt, error: attemptError } = await supabase
        .from('promotional_campaign_login_attempts')
        .select('failed_attempts,window_started_at,locked_until')
        .eq('ip_hash', ipHash)
        .maybeSingle();
      if (attemptError) throw attemptError;
      if (attempt?.locked_until && Date.parse(attempt.locked_until) > now) {
        return jsonResponse({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' }, 429);
      }
      if (typeof body.pin !== 'string' || !constantTimeEquals(body.pin.trim(), configuredPin.trim())) {
        const windowStarted = attempt?.window_started_at ? Date.parse(attempt.window_started_at) : 0;
        const windowIsActive = Number.isFinite(windowStarted) && now - windowStarted < 15 * 60 * 1000;
        const failedAttempts = windowIsActive ? Number(attempt?.failed_attempts || 0) + 1 : 1;
        const { error: saveAttemptError } = await supabase
          .from('promotional_campaign_login_attempts')
          .upsert({
            ip_hash: ipHash,
            failed_attempts: failedAttempts,
            window_started_at: windowIsActive ? attempt.window_started_at : new Date(now).toISOString(),
            locked_until: failedAttempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null,
          });
        if (saveAttemptError) throw saveAttemptError;
        if (failedAttempts >= 5) {
          return jsonResponse({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' }, 429);
        }
        return jsonResponse({ error: 'Invalid administrator PIN.' }, 401);
      }
      const { error: clearAttemptError } = await supabase
        .from('promotional_campaign_login_attempts')
        .delete()
        .eq('ip_hash', ipHash);
      if (clearAttemptError) throw clearAttemptError;
      return jsonResponse({ session: await createAdminSession() });
    }

    await requireSession(body);
    if (action === 'verify-session') return jsonResponse({ success: true });
    const supabase = serviceClient();

    if (action === 'list') {
      const { data, error } = await supabase
        .from('promotional_campaigns')
        .select(CAMPAIGN_COLUMNS)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return jsonResponse({ campaigns: data || [] });
    }

    if (action === 'create-upload-url') {
      const contentType = typeof body.contentType === 'string' ? body.contentType : '';
      const extension = Object.hasOwn(MEDIA_EXTENSIONS, contentType) ? MEDIA_EXTENSIONS[contentType] : '';
      if (!extension) throw new Error('Choose a supported image or video format.');
      const path = `${crypto.randomUUID()}.${extension}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return jsonResponse({ path: data.path, token: data.token });
    }

    if (action === 'create') {
      const fields = validateCampaignFields(body.fields);
      const mediaPath = typeof body.mediaPath === 'string' ? body.mediaPath : '';
      const mediaType = typeof body.mediaType === 'string' ? body.mediaType : '';
      if (!mediaPath || !Object.hasOwn(MEDIA_EXTENSIONS, mediaType)) {
        throw new Error('Campaign media is missing or unsupported.');
      }
      const { data, error } = await supabase
        .from('promotional_campaigns')
        .insert({ ...fields, media_type: mediaType.startsWith('video/') ? 'video' : 'image', media_path: mediaPath })
        .select(CAMPAIGN_COLUMNS)
        .single();
      if (error) throw error;
      return jsonResponse({ campaign: data });
    }

    if (action === 'update') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) throw new Error('Campaign ID is required.');
      const fields = validateCampaignFields(body.fields, true);
      const mediaPath = typeof body.mediaPath === 'string' ? body.mediaPath : '';
      const mediaType = typeof body.mediaType === 'string' ? body.mediaType : '';
      if (mediaPath) {
        if (!Object.hasOwn(MEDIA_EXTENSIONS, mediaType)) throw new Error('Replacement media is unsupported.');
        fields.media_path = mediaPath;
        fields.media_type = mediaType.startsWith('video/') ? 'video' : 'image';
        fields.poster_path = null;
      }
      const { data, error } = await supabase
        .from('promotional_campaigns')
        .update(fields)
        .eq('id', id)
        .select(CAMPAIGN_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Campaign not found.');
      return jsonResponse({ campaign: data });
    }

    if (action === 'delete') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) throw new Error('Campaign ID is required.');
      const { data, error } = await supabase
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
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(paths);
        if (cleanupError) cleanupWarning = `Campaign deleted, but media cleanup failed: ${cleanupError.message}`;
      }
      return jsonResponse({ success: true, cleanupWarning });
    }

    if (action === 'remove-media') {
      const paths = Array.isArray(body.paths)
        ? body.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
        : [];
      if (paths.length) {
        const { error } = await supabase.storage.from(BUCKET).remove(paths);
        if (error) throw error;
      }
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Unknown campaign action.' }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ error: await error.text() }, error.status);
    }
    console.error('Campaign administration request failed:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Campaign request failed.',
    }, 400);
  }
});
