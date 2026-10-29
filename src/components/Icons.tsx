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

export const BackIcon = () => (
  <Icon>
    <path d="M6.5 1.5L3 5l3.5 3.5" />
  </Icon>
);

export const ForwardIcon = () => (
  <Icon>
    <path d="M3.5 1.5L7 5 3.5 8.5" />
  </Icon>
);

export const UpIcon = () => (
  <Icon>
    <path d="M1.5 6.5L5 3l3.5 3.5" />
  </Icon>
);

export const PinIcon = () => (
  <Icon>
    <path d="M3.5 0.5h3M4 0.5v3.5L2 6h6L6 4V0.5M5 6v3.5" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <path d="M1 5h1M4.5 5h1M8 5h1" strokeWidth="1.4" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon>
    <path d="M0.5 1.5h3.5l1 1.2h4.5v6.3h-9z" />
  </Icon>
);

export const FileIcon = () => (
  <Icon>
    <path d="M1.5 0.5h4.5l2.5 2.5v6.5h-7zM6 0.5V3h2.5" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M4 6l4-4M4.5 2H8v3.5" />
  </Icon>
);
