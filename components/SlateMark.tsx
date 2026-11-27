interface SlateMarkProps {
  className?: string;
}

export function SlateMark({ className = "w-6 h-6" }: SlateMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="17" height="17" fill="#0A0A0A" stroke="#E5E5E5" strokeWidth="1" />
      <rect
        x="12"
        y="10"
        width="17"
        height="17"
        fill="#FFFFFF"
        stroke="#0A0A0A"
        strokeWidth="2.5"
      />
      <path
        d="M16 18.5H25M22 15.5L25 18.5L22 21.5"
        stroke="#0A0A0A"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
