import useSWR from 'swr';
import {
  fetchActiveCampaigns,
  PUBLIC_CAMPAIGNS_KEY,
  safeCampaignCtaUrl,
} from '@/lib/promotionalCampaigns';

export default function CampaignsPage() {
  const { data: campaigns, error, isLoading } = useSWR(
    PUBLIC_CAMPAIGNS_KEY,
    fetchActiveCampaigns,
    { revalidateOnFocus: true, dedupingInterval: 60_000, shouldRetryOnError: false }
  );

  return (
    <main className="h-full overflow-y-auto p-4 pb-24 sm:p-6 lg:pb-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">For your store</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Promotions & announcements</h1>
          <p className="mt-1 text-sm text-slate-600">
            Offers and updates from Adimat. Published items you have loaded online are available here offline too.
          </p>
        </header>

        {isLoading && (
          <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Loading promotions…
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Could not load promotions. Reconnect to the internet and try again.
          </p>
        )}

        {!isLoading && !error && campaigns?.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            There are no current promotions.
          </p>
        )}

        {!!campaigns?.length && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((campaign) => {
              const ctaUrl = safeCampaignCtaUrl(campaign.cta_url);
              return (
                <article key={campaign.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {campaign.media_type === 'video' ? (
                    <video
                      src={campaign.media_url}
                      poster={campaign.poster_url || undefined}
                      aria-label={campaign.title}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-[4/3] w-full bg-slate-100 object-contain"
                    />
                  ) : (
                    <img
                      src={campaign.media_url}
                      alt={campaign.alt_text || campaign.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-slate-100 object-contain"
                    />
                  )}
                  <div className="p-4">
                    <h2 className="text-base font-bold text-slate-950">{campaign.title}</h2>
                    {campaign.description && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {campaign.description}
                      </p>
                    )}
                    {ctaUrl && campaign.cta_label && (
                      <a
                        href={ctaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
                      >
                        {campaign.cta_label}
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
