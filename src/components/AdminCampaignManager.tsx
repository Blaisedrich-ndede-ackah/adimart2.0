import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import useSWR from 'swr';
import {
  CAMPAIGN_ADMIN_LIST_KEY,
  CAMPAIGN_ADMIN_STATUS_KEY,
  CAMPAIGN_MAX_MEDIA_BYTES,
  campaignErrorMessage,
  campaignMediaTypeLabel,
  campaignStatusLabel,
  createPromotionCampaign,
  datetimeLocalToIso,
  datetimeLocalValue,
  deletePromotionCampaign,
  fetchAdminCampaigns,
  formatCampaignDate,
  getCampaignAdminAccess,
  isCampaignMigrationMissing,
  normalizeCampaignCtaUrl,
  updatePromotionCampaign,
  validateCampaignDateWindow,
  validateCampaignMedia,
  type CampaignAdminAccess,
  type CampaignFields,
  type PromotionCampaign,
} from '@/lib/promotionalCampaigns';
import { isSupabaseConfigured } from '@/lib/supabase';

const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

interface CampaignDraft {
  title: string;
  description: string;
  alt_text: string;
  cta_label: string;
  cta_url: string;
  is_published: boolean;
  starts_at: string;
  ends_at: string;
  sort_order: string;
}

const EMPTY_DRAFT: CampaignDraft = {
  title: '',
  description: '',
  alt_text: '',
  cta_label: '',
  cta_url: '',
  is_published: false,
  starts_at: '',
  ends_at: '',
  sort_order: '0',
};

export default function AdminCampaignManager() {
  const {
    data: access,
    error: accessError,
    isLoading: accessLoading,
  } = useSWR<CampaignAdminAccess>(CAMPAIGN_ADMIN_STATUS_KEY, getCampaignAdminAccess, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: campaignData,
    error: campaignError,
    isLoading: campaignsLoading,
    isValidating: campaignsValidating,
    mutate: refreshCampaigns,
  } = useSWR<PromotionCampaign[]>(
    access === 'authorized' ? CAMPAIGN_ADMIN_LIST_KEY : null,
    fetchAdminCampaigns,
    { shouldRetryOnError: false }
  );

  const campaigns = campaignData || [];
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_DRAFT);
  const [editingCampaign, setEditingCampaign] = useState<PromotionCampaign | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [rowError, setRowError] = useState('');

  const localPreviewUrl = useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : null),
    [selectedFile]
  );
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  const resetEditor = () => {
    setEditingCampaign(null);
    setDraft(EMPTY_DRAFT);
    setSelectedFile(null);
    setFileInputKey((key) => key + 1);
    setFormError('');
  };

  const startEditing = (campaign: PromotionCampaign) => {
    setEditingCampaign(campaign);
    setDraft({
      title: campaign.title,
      description: campaign.description,
      alt_text: campaign.alt_text,
      cta_label: campaign.cta_label,
      cta_url: campaign.cta_url,
      is_published: campaign.is_published,
      starts_at: datetimeLocalValue(campaign.starts_at),
      ends_at: datetimeLocalValue(campaign.ends_at),
      sort_order: String(campaign.sort_order),
    });
    setSelectedFile(null);
    setFileInputKey((key) => key + 1);
    setFormError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setNotice('');

    const title = draft.title.trim();
    if (!title) {
      setFormError('Add a campaign title.');
      return;
    }
    if (!editingCampaign && !selectedFile) {
      setFormError('Choose a flyer image or video before saving.');
      return;
    }
    if (selectedFile) {
      const mediaError = validateCampaignMedia(selectedFile);
      if (mediaError) {
        setFormError(mediaError);
        return;
      }
    }

    const dateError = validateCampaignDateWindow(draft.starts_at, draft.ends_at);
    if (dateError) {
      setFormError(dateError);
      return;
    }

    let ctaUrl = '';
    try {
      ctaUrl = normalizeCampaignCtaUrl(draft.cta_url);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Enter a valid campaign link.');
      return;
    }
    const ctaLabel = draft.cta_label.trim();
    if (Boolean(ctaUrl) !== Boolean(ctaLabel)) {
      setFormError('Add both a button label and link, or leave both blank.');
      return;
    }

    const sortOrder = Number(draft.sort_order);
    if (!Number.isSafeInteger(sortOrder)) {
      setFormError('Display order must be a whole number.');
      return;
    }

    const fields: CampaignFields = {
      title,
      description: draft.description.trim(),
      alt_text: draft.alt_text.trim(),
      cta_label: ctaLabel,
      cta_url: ctaUrl,
      is_published: draft.is_published,
      starts_at: datetimeLocalToIso(draft.starts_at),
      ends_at: datetimeLocalToIso(draft.ends_at),
      sort_order: sortOrder,
    };

    setFormBusy(true);
    try {
      if (editingCampaign) {
        const result = await updatePromotionCampaign(editingCampaign, fields, selectedFile);
        setNotice(result.cleanupWarning || 'Campaign changes saved.');
      } else {
        await createPromotionCampaign(fields, selectedFile as File);
        setNotice(fields.is_published ? 'Campaign published.' : 'Campaign saved as a draft.');
      }
      resetEditor();
      await refreshCampaigns();
    } catch (error) {
      setFormError(campaignErrorMessage(error));
    } finally {
      setFormBusy(false);
    }
  };

  const togglePublished = async (campaign: PromotionCampaign) => {
    setRowBusyId(campaign.id);
    setRowError('');
    setNotice('');
    try {
      await updatePromotionCampaign(campaign, { is_published: !campaign.is_published });
      setNotice(campaign.is_published ? 'Campaign paused.' : 'Campaign published.');
      await refreshCampaigns();
    } catch (error) {
      setRowError(campaignErrorMessage(error));
    } finally {
      setRowBusyId(null);
    }
  };

  const removeCampaign = async (campaign: PromotionCampaign) => {
    if (!window.confirm(`Delete "${campaign.title}" and its uploaded media?`)) return;
    setRowBusyId(campaign.id);
    setRowError('');
    setNotice('');
    try {
      const cleanupWarning = await deletePromotionCampaign(campaign);
      setNotice(cleanupWarning || 'Campaign deleted.');
      if (editingCampaign?.id === campaign.id) resetEditor();
      await refreshCampaigns();
    } catch (error) {
      setRowError(campaignErrorMessage(error));
    } finally {
      setRowBusyId(null);
    }
  };

  if (!isSupabaseConfigured()) {
    return (
      <section className="space-y-4" aria-labelledby="campaign-manager-title">
        <CampaignManagerHeading />
        <StatusCard title="Campaign tools are unavailable" tone="warning">
          Supabase is not configured in this environment. No credentials or settings were changed.
        </StatusCard>
      </section>
    );
  }

  if (accessLoading || (!access && !accessError)) {
    return (
      <section className="space-y-4" aria-labelledby="campaign-manager-title">
        <CampaignManagerHeading />
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
          Checking campaign administrator access…
        </div>
      </section>
    );
  }

  if (access !== 'authorized') {
    return (
      <section className="space-y-4" aria-labelledby="campaign-manager-title">
        <CampaignManagerHeading />
        {accessError && (
          <StatusCard title="Could not verify access" tone="warning">
            {campaignErrorMessage(accessError)}
          </StatusCard>
        )}
        {access === 'unconfigured' ? (
          <StatusCard title="Campaign tools are unavailable" tone="warning">
            Supabase is not configured in this environment. No credentials or settings were changed.
          </StatusCard>
        ) : access === 'not-authorized' ? (
          <StatusCard title="Administrator role required" tone="warning">
            This Supabase Auth account is not marked as a platform administrator. Ask the project owner to grant the role using the setup instructions in the README.
          </StatusCard>
        ) : (
          <StatusCard title="Admin session required" tone="warning">
            Sign in to the administrator portal to access campaign management.
          </StatusCard>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="campaign-manager-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <CampaignManagerHeading />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshCampaigns()}
            disabled={campaignsValidating}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${campaignsValidating ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {(notice || rowError) && (
        <div
          role={rowError ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${rowError ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
        >
          {rowError || notice}
        </div>
      )}

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={(event) => void submitCampaign(event)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Campaign editor</p>
              <h3 className="mt-1 text-lg font-bold text-slate-950">
                {editingCampaign ? 'Edit campaign' : 'Create a campaign'}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Images and videos up to 50 MB. Public campaigns appear on the store login screen.</p>
            </div>
            {editingCampaign && (
              <button
                type="button"
                onClick={resetEditor}
                className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            )}
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Campaign title
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
                className="min-h-11 rounded-xl border border-slate-300 px-3 font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Description
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
                className="resize-y rounded-xl border border-slate-300 px-3 py-2.5 font-normal leading-5 text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Flyer or video
              <span className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                <Upload className="h-4 w-4 shrink-0 text-emerald-800" />
                <span className="min-w-0 flex-1 truncate">
                  {selectedFile?.name || (editingCampaign ? 'Keep existing media or choose a replacement' : 'Choose an image or video')}
                </span>
                <input
                  key={fileInputKey}
                  type="file"
                  accept={MEDIA_ACCEPT}
                  aria-label="Choose campaign flyer or video"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] || null;
                    setSelectedFile(file);
                    setFormError(file ? validateCampaignMedia(file) || '' : '');
                  }}
                  className="sr-only"
                />
              </span>
              <span className="text-xs font-normal text-slate-500">JPG, PNG, WebP, GIF, MP4, WebM, MOV · maximum 50 MB</span>
            </label>

            {(localPreviewUrl || (editingCampaign && !selectedFile)) && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                  {selectedFile ? (
                    selectedFile.type.startsWith('video/') ? <VideoIcon className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />
                  ) : editingCampaign?.media_type === 'video' ? <VideoIcon className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                  Preview
                </div>
                <div className="flex max-h-64 min-h-36 items-center justify-center bg-slate-100">
                  {selectedFile ? (
                    selectedFile.type.startsWith('video/') ? (
                      <video src={localPreviewUrl || undefined} controls muted playsInline className="max-h-64 w-full object-contain" />
                    ) : (
                      <img src={localPreviewUrl || undefined} alt="Selected campaign media preview" className="max-h-64 w-full object-contain" />
                    )
                  ) : editingCampaign?.media_type === 'video' ? (
                    <video src={editingCampaign.media_url} controls muted playsInline className="max-h-64 w-full object-contain" />
                  ) : (
                    <img src={editingCampaign?.media_url} alt={editingCampaign?.alt_text || editingCampaign?.title || 'Current campaign media'} className="max-h-64 w-full object-contain" />
                  )}
                </div>
              </div>
            )}

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Image description for screen readers
              <input
                maxLength={240}
                value={draft.alt_text}
                onChange={(event) => setDraft((value) => ({ ...value, alt_text: event.target.value }))}
                placeholder="Describe the important message in the flyer"
                className="min-h-11 rounded-xl border border-slate-300 px-3 font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Button label (optional)
                <input
                  maxLength={80}
                  value={draft.cta_label}
                  onChange={(event) => setDraft((value) => ({ ...value, cta_label: event.target.value }))}
                  placeholder="View offer"
                  className="min-h-11 rounded-xl border border-slate-300 px-3 font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Button link (optional)
                <input
                  type="text"
                  inputMode="url"
                  value={draft.cta_url}
                  onChange={(event) => setDraft((value) => ({ ...value, cta_url: event.target.value }))}
                  placeholder="https://example.com"
                  className="min-h-11 rounded-xl border border-slate-300 px-3 font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Starts at (optional)
                <span className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    type="datetime-local"
                    value={draft.starts_at}
                    onChange={(event) => setDraft((value) => ({ ...value, starts_at: event.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-slate-300 pl-9 pr-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                  />
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Ends at (optional)
                <span className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    type="datetime-local"
                    value={draft.ends_at}
                    onChange={(event) => setDraft((value) => ({ ...value, ends_at: event.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-slate-300 pl-9 pr-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                  />
                </span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Display order
                <input
                  type="number"
                  step="1"
                  value={draft.sort_order}
                  onChange={(event) => setDraft((value) => ({ ...value, sort_order: event.target.value }))}
                  className="min-h-11 rounded-xl border border-slate-300 px-3 font-normal text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                />
              </label>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={draft.is_published}
                  onChange={(event) => setDraft((value) => ({ ...value, is_published: event.target.checked }))}
                  className="h-4 w-4 accent-emerald-800"
                />
                Publish when saved
              </label>
            </div>
            <p className="text-xs leading-5 text-slate-500">A published campaign is shown only during its date window. Leave dates blank to make it active immediately and until paused.</p>
          </div>

          {formError && (
            <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={formBusy}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {formBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingCampaign ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {formBusy ? 'Saving campaign…' : editingCampaign ? 'Save changes' : 'Save campaign'}
          </button>
        </form>

        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-950">All campaigns</h3>
              <p className="text-xs text-slate-500">Drafts stay private. Published campaigns show on the store sign-in screen.</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{campaigns.length}</span>
          </div>

          {campaignError && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">{isCampaignMigrationMissing(campaignError) ? 'Campaign setup is not complete' : 'Campaigns could not be loaded'}</p>
              <p className="mt-1 leading-5">{campaignErrorMessage(campaignError)}</p>
              {isCampaignMigrationMissing(campaignError) && (
                <p className="mt-2 text-xs">Run <code className="rounded bg-white px-1.5 py-0.5">supabase-migrate-promotional-campaigns.sql</code> yourself when you are ready. This page does not execute it.</p>
              )}
            </div>
          )}

          {campaignsLoading && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-700" /> Loading campaigns…
            </div>
          )}

          {!campaignsLoading && !campaignError && campaigns.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800">
                <Megaphone className="h-5 w-5" />
              </span>
              <p className="mt-3 font-bold text-slate-900">No campaigns yet</p>
              <p className="mt-1 text-sm text-slate-500">Upload a flyer or video to create your first promotion.</p>
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-2">
            {campaigns.map((campaign) => {
              const status = campaignStatusLabel(campaign);
              const statusClass = status === 'Published'
                ? 'bg-emerald-100 text-emerald-800'
                : status === 'Scheduled'
                  ? 'bg-blue-100 text-blue-800'
                  : status === 'Ended'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-700';
              const busy = rowBusyId === campaign.id;
              return (
                <article key={campaign.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex h-44 items-center justify-center overflow-hidden bg-slate-100">
                    {campaign.media_type === 'video' ? (
                      <video src={campaign.media_url} poster={campaign.poster_url || undefined} muted controls playsInline preload="metadata" className="h-full w-full object-contain" />
                    ) : (
                      <img src={campaign.media_url} alt={campaign.alt_text || campaign.title} loading="lazy" className="h-full w-full object-contain" />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {campaign.media_type === 'video' ? <VideoIcon className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          {campaignMediaTypeLabel(campaign.media_type)}
                        </span>
                        <h4 className="mt-2 break-words font-bold text-slate-950">{campaign.title}</h4>
                        {campaign.description && <p className="mt-1 line-clamp-3 text-sm leading-5 text-slate-600">{campaign.description}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>{status}</span>
                    </div>
                    {(campaign.starts_at || campaign.ends_at) && (
                      <p className="mt-3 flex flex-wrap gap-x-1 text-xs text-slate-500">
                        {campaign.starts_at ? `From ${formatCampaignDate(campaign.starts_at)}` : 'Starts now'}
                        {campaign.ends_at ? ` · Until ${formatCampaignDate(campaign.ends_at)}` : ''}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => startEditing(campaign)}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void togglePublished(campaign)}
                        disabled={busy}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : campaign.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {campaign.is_published ? 'Pause' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeCampaign(campaign)}
                        disabled={busy}
                        className="ml-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        Uploads use the public <code>promotional-campaigns</code> media bucket, so only publish material intended for all signed-in store users.
      </p>
    </section>
  );
}

function CampaignManagerHeading() {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Admin tools</p>
      <h2 id="campaign-manager-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Promotional campaigns</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
        Upload, schedule, publish, and retire campaign flyers or videos for existing store users.
      </p>
    </div>
  );
}

function StatusCard({
  title,
  children,
  tone,
}: {
  title: string;
  children: string;
  tone: 'warning';
}) {
  return (
    <div className={`max-w-2xl rounded-2xl border p-5 ${tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : ''}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h3 className="font-bold">{title}</h3>
          <p className="mt-1 text-sm leading-6">{children}</p>
        </div>
      </div>
    </div>
  );
}
