export interface DashboardCalEvent {
  id: string;
  title: string;
  date: string;
  type: string;
}

export const SLA_DAYS: Record<string, number> = { baixa: 45, media: 30, alta: 15, urgente: 5 };

export const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
