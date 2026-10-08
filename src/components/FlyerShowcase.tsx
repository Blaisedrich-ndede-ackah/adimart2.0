import useSWR from 'swr';
import {
  fetchActiveCampaigns,
  PUBLIC_CAMPAIGNS_KEY,
  safeCampaignCtaUrl,
} from '@/lib/promotionalCampaigns';

export default function FlyerShowcase() {
  const { data: campaigns } = useSWR(PUBLIC_CAMPAIGNS_KEY, fetchActiveCampaigns, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
    refreshInterval: 5 * 60_000,
    shouldRetryOnError: false,
  });

  return (
    <section className="auth-showcase" aria-label="Store promotions and advertisements">
      <div className="auth-showcase-brand">
        <span className="auth-showcase-logo">
          <img src="/logo.png" alt="" />
        </span>
        <span>
          <strong>Adimat</strong>
          <span>Exclusive offers</span>
        </span>
      </div>

      <div className="auth-showcase-copy">
        <p className="auth-showcase-eyebrow">ADMIN PROMOTIONS</p>
        <h2>Special deals & announcements</h2>
        <p>{campaigns?.length ? 'Featured promotions and announcements from Adimat.' : 'Featured promotions, product launches, and announcements from Adimat.'}</p>
      </div>

      {campaigns?.length ? (
        <div className="auth-showcase-features max-h-[36vh] overflow-y-auto pr-1">
          {campaigns.map((campaign) => {
            const ctaUrl = safeCampaignCtaUrl(campaign.cta_url);
            return (
              <article className="auth-showcase-feature" key={campaign.id}>
                {campaign.media_type === 'video' ? (
                  <video
                    src={campaign.media_url}
                    poster={campaign.poster_url || undefined}
                    aria-label={campaign.title}
                    autoPlay
                    muted
                    loop
                    controls
                    playsInline
                    preload="metadata"
                    className="mb-3 aspect-[4/3] w-full rounded-lg bg-slate-100 object-contain"
                  />
                ) : (
                  <img
                    src={campaign.media_url}
                    alt={campaign.alt_text || campaign.title}
                    loading="lazy"
                    className="mb-3 aspect-[4/3] w-full rounded-lg bg-slate-100 object-contain"
                  />
                )}
                <h3>{campaign.title}</h3>
                {campaign.description && <p>{campaign.description}</p>}
                {ctaUrl && campaign.cta_label && (
                  <a
                    href={ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-emerald-800 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                  >
                    {campaign.cta_label}
                  </a>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="auth-showcase-features">
          <article className="auth-showcase-feature">
            <span className="auth-showcase-feature-icon">📢</span>
            <h3>Store announcements</h3>
            <p>Important updates and news from management.</p>
          </article>
          <article className="auth-showcase-feature">
            <span className="auth-showcase-feature-icon">🎁</span>
            <h3>Promotions</h3>
            <p>Current deals and special offers to highlight.</p>
          </article>
          <article className="auth-showcase-feature">
            <span className="auth-showcase-feature-icon">⭐</span>
            <h3>Featured products</h3>
            <p>Boost sales of key items this week.</p>
          </article>
        </div>
      )}

      <p className="auth-showcase-footer">Managed by your store administrator.</p>
    </section>
  );
}
