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

export const GripIcon = () => (
  <Icon>
    <path
      d="M3.5 1.5v0.5M6.5 1.5v0.5M3.5 4.75v0.5M6.5 4.75v0.5M3.5 8v0.5M6.5 8v0.5"
      strokeWidth="1.4"
    />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="M2 3.5L5 6.5 8 3.5" />
  </Icon>
);

// Drawn at 18px in the IDE activity bar, hence the thinner stroke.
export const FilesIcon = () => (
  <Icon>
    <path
      d="M3 2.5h3.5L8.5 4.5v5H3zM6.5 2.5v2h2M3 7.5H1.5V0.5h3.5l1 1"
      strokeWidth="0.7"
    />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="4.2" cy="4.2" r="3.2" strokeWidth="0.7" />
    <path d="M6.5 6.5l3 3" strokeWidth="0.7" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path
      d="M0.8 2h0.6M3 2h6.2M0.8 5h0.6M3 5h6.2M0.8 8h0.6M3 8h6.2"
      strokeWidth="0.7"
    />
  </Icon>
);

export const BranchIcon = () => (
  <Icon>
    <circle cx="2.5" cy="1.8" r="1.1" strokeWidth="0.7" />
    <circle cx="2.5" cy="8.2" r="1.1" strokeWidth="0.7" />
    <circle cx="7.5" cy="3.2" r="1.1" strokeWidth="0.7" />
    <path d="M2.5 2.9v4.2M7.5 4.3c0 2-5 1.5-5 2.8" strokeWidth="0.7" />
  </Icon>
);

// Source Control row actions: stage, unstage and discard.
export const PlusIcon = () => (
  <Icon>
    <path d="M5 1.5v7M1.5 5h7" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M1.5 5h7" />
  </Icon>
);

export const DiscardIcon = () => (
  <Icon>
    <path d="M3 1.5L1 3.5l2 2M1 3.5h5a3 3 0 010 6H3.5" />
  </Icon>
);
