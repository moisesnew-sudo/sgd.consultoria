/** Remove acentos (mantém o restante) e retorna em caixa alta. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Chave de comparação: sem acento, sem caixa, espaços simplificados. */
export function textKey(s: string): string {
  return stripAccents(s.replace(/\s+/g, ' ').trim()).toUpperCase();
}

/** Capitaliza a primeira letra preservando o restante. */
export function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}