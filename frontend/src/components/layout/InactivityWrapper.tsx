import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const WARNING_BEFORE = 5 * 60 * 1000;

export default function InactivityWrapper({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [showWarning, setShowWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowWarning(false);

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setTimeLeft(WARNING_BEFORE / 1000);
      countdownRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
          return prev - 1;
        });
      }, 1000);
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE);

    timerRef.current = setTimeout(() => {
      onLogout();
    }, INACTIVITY_TIMEOUT);
  }, [onLogout]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    const handler = () => resetTimer();
    events.forEach(e => window.addEventListener(e, handler));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [resetTimer]);

  const handleStayActive = () => {
    resetTimer();
  };

  return (
    <>
      {children}
      {showWarning && (
        <Modal
          open
          title="Sessão prestes a expirar"
          size="sm"
          hideClose
          footer={
            <>
              <Button variant="outline" onClick={onLogout} icon={<LogOut size={14} />}>
                Sair
              </Button>
              <Button variant="primary" onClick={handleStayActive} className="flex-1" data-autofocus>
                Manter Sessão
              </Button>
            </>
          }
        >
          <div className="text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
              <Clock className="text-amber-600" size={28} />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sua sessão expirará em <span className="font-bold text-amber-600">{String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}</span> minutos devido à inatividade.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
