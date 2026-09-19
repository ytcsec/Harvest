/** The HARVEST seal from the HARVEST.V2 design: a wheat ear inside a gold ring. */
export function SealLogo({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="#263120" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#DDBD72" strokeWidth="1.5" />
      <circle
        cx="32"
        cy="32"
        r="19"
        fill="none"
        stroke="#DDBD72"
        strokeDasharray="1.5 3.5"
        strokeWidth="1"
        opacity="0.75"
      />
      <path
        d="M32 49V15M32 28Q17 26 23 17Q32 19 32 28M32 38Q17 36 23 27Q32 29 32 38M32 33Q47 31 41 22Q32 24 32 33M32 43Q47 41 41 32Q32 34 32 43"
        fill="#DDBD72"
        stroke="#DDBD72"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
