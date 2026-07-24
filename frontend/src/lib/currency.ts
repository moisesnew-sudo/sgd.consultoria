export const formatCurrencyInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const intPart = padded.slice(0, -2);
  const decPart = padded.slice(-2);
  const fmtInt = new Intl.NumberFormat('pt-BR').format(Number(intPart));
  return `R$ ${fmtInt},${decPart}`;
};

export const parseCurrencyInput = (masked: string): number => {
  const cleaned = masked.replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  return Number(cleaned) || 0;
};
