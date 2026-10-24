export interface LocalSyncOutbox {
  id: string;
  store_id: string;
  table_name: string;
  record_id: string;
  attempts: number;
  status: 'pending' | 'done' | 'error';
  next_attempt_at: string;
  last_error: string;
  created_at: string;
}

export interface VersionedRecord {
  updated_at: string;
  version?: number;
}

export interface StockDelta {
  key: string;
  delta: number;
}
