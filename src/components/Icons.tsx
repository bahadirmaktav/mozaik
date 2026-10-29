// Shared 10×10 line icons so window and panel controls use one stroke weight.
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      {children}
    </svg>
  );
}

export const MinimizeIcon = () => (
  <Icon>
    <path d="M0 5.5h10" />
  </Icon>
);

export const MaximizeIcon = () => (
  <Icon>
    <rect x="0.5" y="0.5" width="9" height="9" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
  </Icon>
);
