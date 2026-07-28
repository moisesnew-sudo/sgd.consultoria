interface LogoProps {
  size?: number;
  variant?: 'full' | 'symbol' | 'horizontal';
  className?: string;
}

/* ─── SVG Filters for 3D enameled/metallic look ─── */
const LogoDefs = () => (
  <defs>
    {/* Background texture gradient */}
    <radialGradient id="bgTex" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stopColor="#1a6b45" />
      <stop offset="60%" stopColor="#0F5132" />
      <stop offset="100%" stopColor="#083a21" />
    </radialGradient>

    {/* Brushed steel divider */}
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#8a9bae" />
      <stop offset="20%" stopColor="#c8d4e0" />
      <stop offset="50%" stopColor="#e8eef4" />
      <stop offset="80%" stopColor="#a8b8c8" />
      <stop offset="100%" stopColor="#708090" />
    </linearGradient>

    {/* Brazil map fill - light olive */}
    <linearGradient id="brazilFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#b5c9a8" />
      <stop offset="50%" stopColor="#9db38e" />
      <stop offset="100%" stopColor="#7fa06c" />
    </linearGradient>

    {/* Orbital ring gradient */}
    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#1a4a2e" />
      <stop offset="30%" stopColor="#2d6b45" />
      <stop offset="60%" stopColor="#1a4a2e" />
      <stop offset="100%" stopColor="#0d3320" />
    </linearGradient>

    {/* Sphere 1 - lime green */}
    <radialGradient id="sphereLime" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stopColor="#a8e063" />
      <stop offset="40%" stopColor="#7ecf3a" />
      <stop offset="100%" stopColor="#4a8f2a" />
    </radialGradient>

    {/* Sphere 2 - moss green */}
    <radialGradient id="sphereMoss" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stopColor="#5a7a4a" />
      <stop offset="40%" stopColor="#3d5a30" />
      <stop offset="100%" stopColor="#1e3320" />
    </radialGradient>

    {/* Sphere 3 - gold */}
    <radialGradient id="sphereGold" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stopColor="#fce181" />
      <stop offset="30%" stopColor="#F4B400" />
      <stop offset="70%" stopColor="#d19e00" />
      <stop offset="100%" stopColor="#8a6600" />
    </radialGradient>

    {/* Specular highlight filter for enameled look */}
    <filter id="enamel" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur" />
      <feSpecularLighting in="blur" surfaceScale="3" specularConstant="0.6" specularExponent="20" result="spec">
        <fePointLight x="80" y="40" z="120" />
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
      <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
    </filter>

    {/* Drop shadow filter for 3D depth */}
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="1" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
    </filter>

    {/* Inner shadow for spheres */}
    <filter id="innerShadow">
      <feOffset dx="0" dy="1" />
      <feGaussianBlur stdDeviation="1.5" result="offset-blur" />
      <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
      <feFlood floodColor="black" floodOpacity="0.4" result="color" />
      <feComposite operator="in" in="color" in2="inverse" result="shadow" />
      <feComposite operator="over" in="shadow" in2="SourceGraphic" />
    </filter>

    {/* Glossy highlight for spheres */}
    <filter id="gloss">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
      <feSpecularLighting in="blur" surfaceScale="5" specularConstant="0.8" specularExponent="30" result="spec">
        <fePointLight x="30" y="20" z="100" />
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
      <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" />
    </filter>

    {/* Subtle texture noise for background */}
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise" />
      <feColorMatrix type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.06 0" in="noise" result="coloredNoise" />
      <feBlend in="SourceGraphic" in2="coloredNoise" mode="multiply" />
    </filter>
  </defs>
);

/* Simplified but recognizable Brazil map path */
const BRAZIL_PATH = `M22.5 5.5c-1.5 0-3 .3-4.5 1C16 7 14 8.5 12.5 10.5c-1 1.2-1.8 2.5-2.2 4-.3 1-.4 2-.2 3 .2.8.5 1.5 1 2 .4.5.8.8 1.3 1.2.5.4 1 .7 1.5 1.2.5.5.8 1 .8 1.5 0 .5-.2 1-.5 1.5-.3.5-.7 1-1.2 1.5-1 .8-2 1.5-2.5 2.5-.5 1-.7 2-.7 3 0 1.5.5 3 1.5 4.5 1 1.5 2.5 3 4.5 4 2 1 4.5 1.5 7 1.5 2.5 0 4.5-.5 6-1.5 1.5-1 2.5-2.5 3-4 .5-1.5.5-3 0-4.5-.5-1.5-1.5-3-3-4-1.5-1-3.5-1.5-5.5-2-1.5-.3-2.8-.7-4-1.2-1.2-.5-2-1-2.5-2-.5-1-.5-2 0-3 .5-1 1.5-2 2.5-2.5 1-.5 2-.7 3-.7`;

export function LogoSymbol({ size = 56, className = '' }: { size?: number; className?: string }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <LogoDefs />

      {/* Background circle with texture */}
      <circle cx="28" cy="28" r="27" fill="url(#bgTex)" filter="url(#noise)" />
      <circle cx="28" cy="28" r="27" stroke="#1a6b45" strokeWidth="1" opacity="0.4" />

      {/* Subtle inner shadow ring */}
      <circle cx="28" cy="28" r="25" fill="none" stroke="#000" strokeWidth="2" opacity="0.15" />

      {/* Brazil map */}
      <g filter="url(#shadow)">
        <path
          d={BRAZIL_PATH}
          fill="url(#brazilFill)"
          stroke="#8aa87a"
          strokeWidth="0.5"
          opacity="0.85"
        />
      </g>

      {/* Orbital ring */}
      <circle
        cx="28" cy="28" r="18"
        fill="none"
        stroke="url(#ringGrad)"
        strokeWidth="2.5"
        opacity="0.7"
      />
      <circle
        cx="28" cy="28" r="18"
        fill="none"
        stroke="#fff"
        strokeWidth="0.3"
        opacity="0.15"
      />

      {/* Orbital connection arcs */}
      <path d="M28 10 A18 18 0 0 1 42 22" stroke="#2d6b45" strokeWidth="1" fill="none" opacity="0.4" />
      <path d="M28 46 A18 18 0 0 1 14 34" stroke="#2d6b45" strokeWidth="1" fill="none" opacity="0.4" />

      {/* Sphere 1 - Lime green (top) */}
      <g filter="url(#gloss)">
        <circle cx="28" cy="10" r="4.5" fill="url(#sphereLime)" />
        {/* Highlight */}
        <ellipse cx="27" cy="8.5" rx="2" ry="1.2" fill="white" opacity="0.4" />
      </g>

      {/* Sphere 2 - Moss green (bottom-left) */}
      <g filter="url(#gloss)">
        <circle cx="11" cy="39" r="4.5" fill="url(#sphereMoss)" />
        <ellipse cx="10" cy="37.5" rx="2" ry="1.2" fill="white" opacity="0.3" />
      </g>

      {/* Sphere 3 - Gold (bottom-right) */}
      <g filter="url(#gloss)">
        <circle cx="44" cy="39" r="4.5" fill="url(#sphereGold)" />
        <ellipse cx="43" cy="37.5" rx="2" ry="1.2" fill="white" opacity="0.5" />
      </g>

      {/* Brushed steel divider line */}
      <line x1="54" y1="4" x2="54" y2="52" stroke="url(#steel)" strokeWidth="2" opacity="0.4" />
      <line x1="54" y1="4" x2="54" y2="52" stroke="#fff" strokeWidth="0.5" opacity="0.08" />
    </svg>
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
    <div className={`flex items-start gap-4 ${className}`}>
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
