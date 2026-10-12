-- Add offline-recorded MoMo, bank transfer, and standalone card-terminal payments.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_payment_method_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'split', 'paystack', 'momo_mtn', 'momo_telecel',
    'momo_airteltigo', 'bank_transfer', 'card_terminal'
  ));

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS manual_payment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100) NOT NULL DEFAULT '';
