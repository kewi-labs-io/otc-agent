export const SolanaLogo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M4.5 17.5L8 14l3.5 3.5L8 21 4.5 17.5z" />
    <path d="M16 3.5l3.5 3.5L16 10.5 12.5 7 16 3.5z" />
    <path d="M8 14l3.5-3.5L15 14l-3.5 3.5L8 14z" />
  </svg>
);

export const BaseLogo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
);
