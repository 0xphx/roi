export const euro = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value)
    : '—';
export const money = (value: number, currency = 'USD') =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value)
    : '—';
export const pct = (value: number, sign = false) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', {
        style: 'percent',
        maximumFractionDigits: 2,
        minimumFractionDigits: 1,
        signDisplay: sign ? 'exceptZero' : 'auto',
      }).format(value)
    : '—';
export const decimal = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value)
    : '—';
export const dateLabel = (value: string) =>
  value
    ? new Date(value + 'T12:00:00').toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';
export const shortDate = (value: string) =>
  new Date(value + 'T12:00:00').toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
export const CLASS_LABEL: Record<string, string> = {
  equity: 'Aktien',
  bond: 'Anleihen',
  gold: 'Gold',
  crypto: 'Krypto',
  realestate: 'Immobilien',
};
