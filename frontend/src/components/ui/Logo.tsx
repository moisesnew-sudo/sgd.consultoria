interface LogoProps {
  size?: number;
  variant?: 'full' | 'symbol' | 'horizontal';
  className?: string;
}

const LOGO_PATH = '/logo.jpg';

export function LogoSymbol({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={LOGO_PATH}
      alt="MAPA"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      style={{ borderRadius: size * 0.18 }}
    />
  );
}

export function LogoHorizontal({ size = 32, className = '' }: { size?: number; className?: string }) {
  const s = size;
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoSymbol size={s * 1.3} />
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className="font-extrabold tracking-tight text-gov-900 dark:text-white"
            style={{ fontSize: s * 0.5 }}
          >
            SGD
          </span>
          <span
            className="font-bold tracking-tight text-gov-700 dark:text-gov-400"
            style={{ fontSize: s * 0.5 }}
          >
            Brasil
          </span>
        </div>
        <p
          className="font-semibold text-slate-400 dark:text-slate-500 tracking-tight leading-tight -mt-0.5"
          style={{ fontSize: s * 0.28 }}
        >
          Gestão de Demandas
        </p>
      </div>
    </div>
  );
}

export function LogoFull({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <LogoSymbol size={56} />
      <div className="min-w-0 pt-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <h1 className="text-xl font-extrabold tracking-tight text-white dark:text-white leading-none">
            CGASI
          </h1>
          <h1 className="text-xl font-bold tracking-tight text-gov-500 dark:text-gold leading-none">
            .SE
          </h1>
        </div>
        <p className="text-[10px] font-semibold text-white/80 dark:text-white/80 tracking-wide leading-tight mt-1">
          COORDENAÇÃO GERAL DE
        </p>
        <p className="text-[10px] font-semibold text-white/80 dark:text-white/80 tracking-wide leading-tight">
          ARTICULAÇÃO E SUPERVISÃO
        </p>
        <p className="text-[10px] font-semibold text-white/80 dark:text-white/80 tracking-wide leading-tight">
          INSTITUCIONAL DA SECRETARIA EXECUTIVA
        </p>
        <p className="text-[10px] font-extrabold text-gov-500 dark:text-gold tracking-wider leading-tight mt-1">
          MAPA
        </p>
      </div>
    </div>
  );
}

export default LogoFull;
