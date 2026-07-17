export type DemandStatus = 'triagem' | 'analise_tecnica' | 'em_andamento' | 'concluido' | 'cancelado';
export type DemandPriority = 'baixa' | 'media' | 'alta' | 'urgente';
export type UserRole = 'admin' | 'user' | 'viewer';
export type Region = 'Norte' | 'Nordeste' | 'Sudeste' | 'Sul' | 'Centro-Oeste';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface UserResponse {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface MunicipalityData {
  id?: number;
  name: string;
  uf: string;
  demands_count: number;
  total_value: number;
  schools_count: number;
  population: number;
  hdi: number;
  region: Region;
}

export interface TimelineEvent {
  id: string;
  demand_id: string;
  title: string;
  description: string;
  user_name: string;
  status_changed_to?: DemandStatus;
  created_at: string;
}

export interface Attachment {
  id?: number;
  demand_id: string;
  name: string;
  size: string;
  type: string;
  file_path?: string;
}

export interface Demand {
  id: string;
  title: string;
  description: string;
  category: string;
  status: DemandStatus;
  priority: DemandPriority;
  municipality: string;
  uf: string;
  requested_value: number;
  prefeitura: string;
  proposal_number: string;
  organ: string;
  process_link?: string;
  responsible_name: string;
  responsible_email: string;
  responsible_phone: string;
  notes?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
  timeline?: TimelineEvent[];
  attachments?: Attachment[];
}

export interface SystemSettings {
  id?: number;
  sla_days_baixa: number;
  sla_days_media: number;
  sla_days_alta: number;
  sla_days_urgente: number;
  auto_triage: boolean;
  email_notifications: boolean;
  budget_cap: number;
}

export interface AuthRequest extends Express.Request {
  user?: UserResponse;
}