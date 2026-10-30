export const SUPPORT_CATEGORIES = ['billing', 'technical', 'stock', 'sales', 'account', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export type SupportSource = 'admin' | 'owner' | 'customer';
export type SupportVisibility = 'public' | 'internal';
export type SupportAuthorRole = 'admin' | 'owner' | 'cashier' | 'customer';

export interface LocalSupportTicket {
  id: string;
  store_id: string;
  reference: string;
  source: SupportSource;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  assignee_name: string;
  subject: string;
  opened_by_name: string;
  sla_first_response_due: string;
  sla_resolution_due: string;
  first_response_at: string | null;
  resolved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalSupportMessage {
  id: string;
  ticket_id: string;
  store_id: string;
  author_role: SupportAuthorRole;
  author_name: string;
  body: string;
  visibility: SupportVisibility;
  attachment_name: string;
  attachment_data_url: string;
  created_at: string;
  synced: number;
}

export interface LocalCannedReply {
  id: string;
  title: string;
  body: string;
  updated_at: string;
  synced: number;
}

export interface LocalSupportNotification {
  id: string;
  store_id: string;
  ticket_id: string;
  title: string;
  body: string;
  created_at: string;
  read: number;
}
