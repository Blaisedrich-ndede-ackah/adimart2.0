export default function FlyerShowcase() {
  // This section is reserved for admin-managed flyers and advertisements
  // Displayed to existing users on the login screen
  // Future: Connect to admin dashboard to manage promotional content
  
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
        <p>Your administrator can display featured promotions, new product launches, and store announcements here to keep staff informed.</p>
      </div>

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

      <p className="auth-showcase-footer">Managed by your store administrator.</p>
    </section>
  );
}
