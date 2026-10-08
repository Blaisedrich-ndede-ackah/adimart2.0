import { BarChart3, CreditCard, Package, Store, Wallet } from 'lucide-react';

type AuthShowcaseProps = {
  variant: 'store' | 'admin';
  eyebrow: string;
  title: string;
  description: string;
};

const features = {
  store: [
    { icon: Store, title: 'Point of sale', description: 'Move from products to payment.' },
    { icon: Package, title: 'Inventory', description: 'Know what is in stock and where.' },
    { icon: BarChart3, title: 'Reports', description: 'See sales and trends at a glance.' },
  ],
  admin: [
    { icon: Store, title: 'Stores', description: 'Review stores and access.' },
    { icon: CreditCard, title: 'Subscriptions', description: 'Keep plan status in view.' },
    { icon: Wallet, title: 'Payouts', description: 'Follow weekly remittances.' },
  ],
} satisfies Record<AuthShowcaseProps['variant'], Array<{ icon: typeof Store; title: string; description: string }>>;

export default function AuthShowcase({ variant, eyebrow, title, description }: AuthShowcaseProps) {
  return (
    <section className="auth-showcase" aria-label="Adimat platform overview">
      <div className="auth-showcase-brand">
        <span className="auth-showcase-logo">
          <img src="/logo.png" alt="" />
        </span>
        <span>
          <strong>Adimat</strong>
          <span>Store operations</span>
        </span>
      </div>

      <div className="auth-showcase-copy">
        <p className="auth-showcase-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="auth-showcase-features">
        {features[variant].map(({ icon: Icon, title: featureTitle, description: featureDescription }) => (
          <article className="auth-showcase-feature" key={featureTitle}>
            <span className="auth-showcase-feature-icon">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3>{featureTitle}</h3>
            <p>{featureDescription}</p>
          </article>
        ))}
      </div>

      <p className="auth-showcase-footer">Built for the work of running a store.</p>
    </section>
  );
}
