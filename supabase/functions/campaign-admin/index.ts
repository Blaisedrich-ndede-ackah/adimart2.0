import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sessionSecret = Deno.env.get('CAMPAIGN_SESSION_SECRET') || '';
const campaignBucket = 'promotional-campaigns';
const allowedMediaTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);
const columns = 'id,title,description,media_type,media_path,poster_path,alt_text,cta_label,cta_url,is_published,starts_at,ends_at,sort_order,created_at,updated_at';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

async function signSession(): Promise<string> {
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    iss: 'adimat-campaign-admin',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  })));
  const content = `${header}.${payload}`;
  return `${content}.${encodeBase64Url(await hmac(content))}`;
}

async function verifySession(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const content = `${parts[0]}.${parts[1]}`;
  if (!constantTimeEqual(encodeBase64Url(await hmac(content)), parts[2])) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as { iss?: string; exp?: number };
    return payload.iss === 'adimat-campaign-admin' && Number(payload.exp) > Date.now() / 1000;
  } catch {
    return false;
  }
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

function mediaExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  };
  return extensions[mimeType] || '';
}

async function beginLogin(body: Record<string, unknown>, request: Request): Promise<Response> {
  const expectedPin = Deno.env.get('ADMIN_PORTAL_PIN') || '';
  if (expectedPin.length < 4 || sessionSecret.length < 32) {
    return respond({ error: 'Secure admin sign-in is not configured.' }, 503);
  }

  const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  const recentSince = new Date(Date.now() - 15 * 60_000).toISOString();
  await admin.from('campaign_admin_auth_challenges')
    .delete()
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  const { count, error: rateError } = await admin
    .from('campaign_admin_auth_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('source_ip', sourceIp)
    .gte('created_at', recentSince);
  if (rateError) return respond({ error: 'Campaign sign-in is not configured. Apply the campaign admin migration.' }, 503);
  if ((count || 0) >= 5) return respond({ error: 'Too many sign-in codes requested. Try again in 15 minutes.' }, 429);

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!constantTimeEqual(pin, expectedPin)) {
    const { error: failedPinError } = await admin.from('campaign_admin_auth_challenges').insert({
      id: crypto.randomUUID(),
      code_hash: 'invalid-pin-attempt',
      source_ip: sourceIp,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (failedPinError) return respond({ error: 'Could not verify administrator PIN.' }, 503);
    return respond({ error: 'Invalid administrator PIN.' }, 401);
  }

  const { data: settings, error: settingsError } = await admin
    .from('platform_settings')
    .select('admin_phone,contact_whatsapp,mnotify_api_key,mnotify_sender_id')
    .eq('id', 'main')
    .maybeSingle();
  if (settingsError) return respond({ error: 'Could not load administrator SMS settings.' }, 503);

  const phone = normalizePhone(Deno.env.get('ADMIN_PHONE') || settings?.admin_phone || settings?.contact_whatsapp || '');
  const apiKey = Deno.env.get('MNOTIFY_API_KEY') || settings?.mnotify_api_key || '';
  const sender = (Deno.env.get('MNOTIFY_SENDER_ID') || settings?.mnotify_sender_id || 'Adimat').slice(0, 11);
  if (!/^233[2-9]\d{8}$/.test(phone)) return respond({ error: 'Set a valid admin phone under Admin → Contact.' }, 400);
  if (!apiKey) return respond({ error: 'Configure the mNotify API key under Admin → Contact.' }, 400);

  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const code = String(random[0] % 10_000).padStart(4, '0');
  const id = crypto.randomUUID();
  const codeHash = encodeBase64Url(await hmac(`${id}:${code}`));
  const { error: insertError } = await admin.from('campaign_admin_auth_challenges').insert({
    id,
    code_hash: codeHash,
    source_ip: sourceIp,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  if (insertError) return respond({ error: 'Could not start SMS verification.' }, 503);

  let smsResponse: Response;
  try {
    smsResponse = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: [phone], sender, message: `Adimat Admin login code: ${code}. Valid for 5 minutes.`,
        is_schedule: false, schedule_date: '',
      }),
    });
  } catch {
    return respond({ error: 'Could not send the SMS code. Check the mNotify connection.' }, 502);
  }
  const smsBody = await smsResponse.json().catch(() => ({})) as { status?: string | number; code?: string | number; message?: string; summary?: { message_id?: string } };
  const sent = smsResponse.ok && (
    smsBody.status === 'success' || smsBody.status === 'ok' || smsBody.code === 2000 ||
    smsBody.code === '2000' || Boolean(smsBody.summary?.message_id)
  );
  if (!sent) return respond({ error: smsBody.message || 'mNotify could not send the SMS code.' }, 502);

  return respond({ challengeId: id, maskedPhone: `***${phone.slice(-4)}` });
}

async function verifyLogin(body: Record<string, unknown>): Promise<Response> {
  if (sessionSecret.length < 32) return respond({ error: 'Secure admin sign-in is not configured.' }, 503);
  const id = typeof body.challengeId === 'string' ? body.challengeId : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}$/.test(code)) {
    return respond({ error: 'Enter the 4-digit SMS code.' }, 400);
  }
  const { data: challenge, error } = await admin
    .from('campaign_admin_auth_challenges')
    .select('id,code_hash,attempts,expires_at,used_at')
    .eq('id', id)
    .maybeSingle();
  if (error || !challenge || challenge.used_at || Date.parse(challenge.expires_at) <= Date.now() || challenge.attempts >= 5) {
    return respond({ error: 'Code expired. Enter your PIN again.' }, 401);
  }

  const matches = constantTimeEqual(challenge.code_hash, encodeBase64Url(await hmac(`${id}:${code}`)));
  const attempts = Number(challenge.attempts) + 1;
  const { data: claimed, error: updateError } = await admin.from('campaign_admin_auth_challenges').update({
    attempts,
    used_at: matches ? new Date().toISOString() : attempts >= 5 ? new Date().toISOString() : null,
  }).eq('id', id).eq('attempts', challenge.attempts).is('used_at', null).select('id').maybeSingle();
  if (updateError) return respond({ error: 'Could not verify the SMS code.' }, 503);
  if (!claimed) return respond({ error: 'Code expired. Enter your PIN again.' }, 401);
  if (!matches) return respond({ error: attempts >= 5 ? 'Too many incorrect codes. Enter your PIN again.' : 'Incorrect SMS code.' }, 401);

  return respond({ sessionToken: await signSession() });
}

async function campaignAction(action: string, body: Record<string, unknown>): Promise<Response> {
  const token = typeof body.sessionToken === 'string' ? body.sessionToken : '';
  if (sessionSecret.length < 32 || !await verifySession(token)) return respond({ error: 'Admin session expired. Sign in to the admin portal again.' }, 401);

  if (action === 'create-upload') {
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    const extension = mediaExtension(mimeType);
    if (!extension) return respond({ error: 'This media format is not supported.' }, 400);
    const path = `${crypto.randomUUID()}.${extension}`;
    const { data, error } = await admin.storage.from(campaignBucket).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) return respond({ error: error?.message || 'Could not prepare media upload.' }, 400);
    return respond({ path, token: data.token });
  }

  if (action === 'list') {
    const { data, error } = await admin.from('promotional_campaigns').select(columns)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(200);
    if (error) return respond({ error: error.message }, 400);
    const storage = admin.storage.from(campaignBucket);
    return respond((data || []).map((row) => ({
      ...row,
      media_url: storage.getPublicUrl(row.media_path).data.publicUrl,
      poster_url: row.poster_path ? storage.getPublicUrl(row.poster_path).data.publicUrl : null,
    })));
  }

  if (action === 'create') {
    const fields = body.fields as Record<string, unknown> | undefined;
    const mediaPath = typeof body.mediaPath === 'string' ? body.mediaPath : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!fields || typeof fields.title !== 'string' || !fields.title.trim() || !mediaPath || !allowedMediaTypes.has(mimeType)) {
      return respond({ error: 'Campaign details or media are invalid.' }, 400);
    }
    const { data, error } = await admin.from('promotional_campaigns').insert({
      ...fields,
      title: fields.title.trim(),
      media_type: mimeType.startsWith('video/') ? 'video' : 'image',
      media_path: mediaPath,
    }).select(columns).single();
    if (error || !data) {
      await admin.storage.from(campaignBucket).remove([mediaPath]);
      return respond({ error: error?.message || 'Could not create campaign.' }, 400);
    }
    return respond({ ...data, media_url: admin.storage.from(campaignBucket).getPublicUrl(data.media_path).data.publicUrl, poster_url: null });
  }

  if (action === 'update') {
    const id = typeof body.id === 'string' ? body.id : '';
    const fields = body.fields as Record<string, unknown> | undefined;
    const replacementPath = typeof body.mediaPath === 'string' ? body.mediaPath : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!id || !fields || (replacementPath && !allowedMediaTypes.has(mimeType))) return respond({ error: 'Campaign update is invalid.' }, 400);
    const { data: current, error: currentError } = await admin.from('promotional_campaigns').select('media_path,poster_path').eq('id', id).single();
    if (currentError || !current) return respond({ error: 'Campaign not found.' }, 404);
    const updates: Record<string, unknown> = { ...fields };
    if (replacementPath) {
      updates.media_path = replacementPath;
      updates.media_type = mimeType.startsWith('video/') ? 'video' : 'image';
      updates.poster_path = null;
    }
    const { data, error } = await admin.from('promotional_campaigns').update(updates).eq('id', id).select(columns).single();
    if (error || !data) {
      if (replacementPath) await admin.storage.from(campaignBucket).remove([replacementPath]);
      return respond({ error: error?.message || 'Could not update campaign.' }, 400);
    }
    let cleanupWarning = '';
    if (replacementPath) {
      const oldPaths = [current.media_path, current.poster_path].filter((path): path is string => Boolean(path));
      const { error: cleanupError } = await admin.storage.from(campaignBucket).remove(oldPaths);
      if (cleanupError) cleanupWarning = 'Campaign saved, but the previous media file could not be removed.';
    }
    return respond({ campaign: { ...data, media_url: admin.storage.from(campaignBucket).getPublicUrl(data.media_path).data.publicUrl, poster_url: data.poster_path ? admin.storage.from(campaignBucket).getPublicUrl(data.poster_path).data.publicUrl : null }, cleanupWarning });
  }

  if (action === 'delete') {
    const id = typeof body.id === 'string' ? body.id : '';
    const { data: current, error: currentError } = await admin.from('promotional_campaigns').select('media_path,poster_path').eq('id', id).single();
    if (currentError || !current) return respond({ error: 'Campaign not found.' }, 404);
    const { error } = await admin.from('promotional_campaigns').delete().eq('id', id);
    if (error) return respond({ error: error.message }, 400);
    const paths = [current.media_path, current.poster_path].filter((path): path is string => Boolean(path));
    const { error: cleanupError } = await admin.storage.from(campaignBucket).remove(paths);
    return respond({ cleanupWarning: cleanupError ? 'Campaign was deleted, but its stored media could not be removed.' : '' });
  }

  if (action === 'remove-media') {
    const paths = Array.isArray(body.paths) ? body.paths.filter((path): path is string => typeof path === 'string') : [];
    if (paths.length) {
      const { error } = await admin.storage.from(campaignBucket).remove(paths);
      if (error) return respond({ error: error.message }, 400);
    }
    return respond({ success: true });
  }

  return respond({ error: 'Unsupported campaign action.' }, 400);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'begin-login') return await beginLogin(body, request);
    if (action === 'verify-login') return await verifyLogin(body);
    return await campaignAction(action, body);
  } catch (error) {
    console.error('Campaign admin function failed', error);
    return respond({ error: 'Campaign request could not be completed.' }, 500);
  }
});