interface LogoProps {
  size?: number;
  variant?: 'full' | 'symbol' | 'horizontal';
  theme?: 'light' | 'dark';
  className?: string;
}

export function LogoSymbol({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* External hexagon shield */}
      <rect x="3" y="3" width="34" height="34" rx="8" className="fill-gov-700 dark:fill-gov-600" />
      
      {/* Inner shape - stylized Brazil outline */}
      <path
        d="M12 20C12 16 15 12 20 12C25 12 28 15 28 18C28 22 25 28 20 28C16 28 12 24 12 20Z"
        className="fill-white/90 dark:fill-gov-900"
        opacity="0.9"
      />
      
      {/* Map silhouette suggestion */}
      <path
        d="M15 19C15 16 17.5 14 20 14C22.5 14 25 16 25 19C25 22 23 26 20 26C17 26 15 22 15 19Z"
        className="fill-gov-700 dark:fill-gov-500"
        opacity="0.5"
      />
      
      {/* Connection node - Brasília (center) */}
      <circle cx="20" cy="19" r="2" className="fill-gold dark:fill-gold-light" />
      
      {/* Connection arcs */}
      <path
        d="M20 19L14 15"
        className="stroke-gold dark:stroke-gold-light"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M20 19L26 15"
        className="stroke-gold dark:stroke-gold-light"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M20 19L16 25"
        className="stroke-gold dark:stroke-gold-light"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M20 19L24 25"
        className="stroke-gold dark:stroke-gold-light"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.6"
      />
      
      {/* Regional nodes */}
      <circle cx="14" cy="15" r="1.2" className="fill-white/80 dark:fill-gov-200" opacity="0.7" />
      <circle cx="26" cy="15" r="1.2" className="fill-white/80 dark:fill-gov-200" opacity="0.7" />
      <circle cx="16" cy="25" r="1.2" className="fill-white/80 dark:fill-gov-200" opacity="0.7" />
      <circle cx="24" cy="25" r="1.2" className="fill-white/80 dark:fill-gov-200" opacity="0.7" />
    </svg>
  );
}

export function LogoHorizontal({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoSymbol size={size} />
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-extrabold tracking-tight text-gov-900 dark:text-white" style={{ fontSize: size * 0.55 }}>
            SGD
          </span>
          <span className="font-bold tracking-tight text-gov-700 dark:text-gov-400" style={{ fontSize: size * 0.55 }}>
            Brasil
          </span>
        </div>
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-tight leading-tight -mt-0.5">
          Gestão de Demandas
        </p>
      </div>
    </div>
  );
}

export function LogoFull({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-3.5 ${className}`}>
      <LogoSymbol size={44} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-gov-900 dark:text-white leading-none">
            SGD
          </h1>
          <h1 className="text-xl font-bold tracking-tight text-gov-700 dark:text-gov-400 leading-none">
            Brasil
          </h1>
        </div>
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide leading-tight mt-0.5">
          Sistema Inteligente de Gestão de Demandas
        </p>
        <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700/50">
          <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 leading-tight">
            CGASI.SE
          </p>
          <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500 leading-tight">
            Coordenação Geral de Articulação e Supervisão Institucional
          </p>
          <p className="text-[7px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5 tracking-wider uppercase">
            Secretaria Executiva • MAPA
          </p>
        </div>
      </div>
    </div>
  );
}

export default LogoFull;
