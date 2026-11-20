/** Points earned on the amount the customer actually pays, after discounts and redemption. */
export function pointsEarned(amountPaid: number, earnRate: number): number {
  const rate = Math.floor(Number(earnRate) || 0);
  const amount = Number(amountPaid) || 0;
  if (rate <= 0 || amount <= 0) return 0;
  return Math.floor(amount * rate);
}

/** Currency value of points. redeemValue is the currency amount of one point. */
export function pointsValue(points: number, redeemValue: number): number {
  const count = Math.floor(Number(points) || 0);
  const each = Number(redeemValue) || 0;
  if (count <= 0 || each <= 0) return 0;
  return Math.round(count * each * 100) / 100;
}

export function capRedeemPoints(requested: number, balance: number, redeemValue: number, payable: number): number {
  const available = Math.max(0, Math.floor(Number(balance) || 0));
  let points = Math.max(0, Math.min(Math.floor(Number(requested) || 0), available));
  if (points <= 0) return 0;
  const each = Number(redeemValue) || 0;
  if (each <= 0) return 0;
  const maxPointsByPayable = Math.floor((Math.max(0, payable) + 0.0001) / each);
  points = Math.min(points, Math.max(0, maxPointsByPayable));
  return points;
}
