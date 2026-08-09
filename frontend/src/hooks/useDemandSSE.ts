/**
 * Fase D1.6 — Hook SSE para atualização em tempo real de demandas.
 *
 * Conecta ao endpoint /api/events/integrations e notifica
 * quando demandas são criadas, atualizadas, status muda, ou comentários são adicionados.
 *
 * F2.1 — Renovação de autenticação:
 * - Trata o evento `sse:reconnect` (token próximo ao vencimento / shutdown do servidor);
 * - Renova o token (POST /api/auth/refresh) antes de reconectar;
 * - Reconnect automático com backoff simples.
 *
 * Uso:
 *   useDemandSSE(() => refreshDemands());
 */

import { useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.gruposgd.com.br';
const SSE_URL = `${API_BASE}/api/events/integrations`;

/** Evento enviado pelo servidor quando o cliente deve renovar o token e reconectar. */
const SSE_RECONNECT_EVENT = 'sse:reconnect';
/** Retry padrão quando o servidor não informa retryMs. */
const FALLBACK_RETRY_MS = 30_000;

const DEMAND_EVENTS = [
  'demand:created',
  'demand:updated',
  'demand:status_changed',
  'demand:deleted',
  'comment:created',
] as const;

type DemandEventType = (typeof DEMAND_EVENTS)[number];

interface UseDemandSSEOptions {
  onEvent?: (event: DemandEventType, data: unknown) => void;
  onRefreshNeeded?: () => void;
  /** Chamado quando o servidor pede reconexão (token expirando, shutdown). */
  onReconnectNeeded?: (reason: string) => void;
  enabled?: boolean;
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Renova o access token via refresh token (cookies HttpOnly). */
async function refreshAuthToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() || '' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Hook que mantém conexão SSE aberta para eventos de demandas.
 * Quando um evento chega, chama onRefreshNeeded para invalidar dados.
 * Em `sse:reconnect` ou erro de conexão, renova o token e reconecta.
 */
export function useDemandSSE(options: UseDemandSSEOptions = {}) {
  const { onEvent, onRefreshNeeded, onReconnectNeeded, enabled = true } = options;
  const onRefreshNeededRef = useRef(onRefreshNeeded);
  const onEventRef = useRef(onEvent);
  const onReconnectNeededRef = useRef(onReconnectNeeded);

  onRefreshNeededRef.current = onRefreshNeeded;
  onEventRef.current = onEvent;
  onReconnectNeededRef.current = onReconnectNeeded;

  useEffect(() => {
    if (!enabled) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(delayMs: number) {
      if (disposed) return;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delayMs);
    }

    async function reconnectWithNewToken(delayMs: number, reason: string) {
      onReconnectNeededRef.current?.(reason);
      eventSource?.close();
      eventSource = null;

      const refreshed = await refreshAuthToken();
      if (disposed) return;
      scheduleReconnect(refreshed ? delayMs : FALLBACK_RETRY_MS);
    }

    function connect() {
      if (disposed) return;

      const es = new EventSource(SSE_URL, { withCredentials: true });
      eventSource = es;

      es.addEventListener(SSE_RECONNECT_EVENT, ((e: MessageEvent) => {
        let reason = 'token_expiring';
        let retryMs: number | undefined;
        try {
          const data = JSON.parse(e.data);
          if (typeof data?.reason === 'string') reason = data.reason;
          if (typeof data?.retryMs === 'number') retryMs = data.retryMs;
        } catch {
          // payload inválido — usa defaults
        }
        void reconnectWithNewToken(retryMs ?? FALLBACK_RETRY_MS, reason);
      }) as EventListener);

      for (const eventName of DEMAND_EVENTS) {
        es.addEventListener(eventName, ((e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            onEventRef.current?.(eventName, data);
            onRefreshNeededRef.current?.();
          } catch {
            // ignora parse errors
          }
        }) as EventListener);
      }

      es.onopen = () => {
        // conectado
      };

      es.onerror = () => {
        es.close();
        eventSource = null;
        void reconnectWithNewToken(200, 'connection_error');
      };
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      eventSource?.close();
      eventSource = null;
    };
  }, [enabled]);
}
