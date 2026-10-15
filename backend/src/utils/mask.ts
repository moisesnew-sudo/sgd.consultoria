export function maskText(text: string): string {
  if (text.length === 0) return '';
  if (text.length <= 2) return '*'.repeat(text.length);

  return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
}

export function maskCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return maskText(cpf);

  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

export function maskEmail(email: string): string {
  const separator = email.lastIndexOf('@');
  if (separator <= 0 || separator === email.length - 1) return maskText(email);

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (localPart.length === 1) return `*@${domain}`;

  return `${localPart[0]}${'*'.repeat(Math.max(3, localPart.length - 2))}${localPart.at(-1)}@${domain}`;
}
