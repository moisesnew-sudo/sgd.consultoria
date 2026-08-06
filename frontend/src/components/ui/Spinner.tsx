interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export function Spinner({ size = 16, className = '', label }: SpinnerProps) {
  return (
    <span className={`inline-flex items-center justify-center gap-2 ${className}`}>
      <svg
        className="animate-spin"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}
