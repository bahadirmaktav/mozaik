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
    <circle cx="2.6" cy="1.9" r="1.2" strokeWidth="0.7" />
    <circle cx="2.6" cy="8.1" r="1.2" strokeWidth="0.7" />
    <circle cx="7.4" cy="1.9" r="1.2" strokeWidth="0.7" />
    <path
      d="M2.6 3.1v3.8M7.4 3.1v0.6c0 1.6-1.2 2.1-2.4 2.3-1.2 0.2-2.4 0.4-2.4 0.9"
      strokeWidth="0.7"
    />
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

// Run and Debug: the activity bar icon (a bug, 18px) and the debug toolbar's controls.
export const DebugIcon = () => (
  <Icon>
    <path d="M3.6 3.3a1.4 1.4 0 012.8 0" strokeWidth="0.7" />
    <rect x="2.9" y="3.3" width="4.2" height="5.4" rx="2.1" strokeWidth="0.7" />
    <path
      d="M5 4.6v4.1M4.1 1.4l0.6 0.9M5.9 1.4l-0.6 0.9M2.9 4.8H1.3M2.9 6.5H1M3.1 8l-1.4 1M7.1 4.8h1.6M7.1 6.5H9M6.9 8l1.4 1"
      strokeWidth="0.7"
    />
  </Icon>
);

export const ContinueIcon = () => (
  <Icon>
    <path d="M1.5 1v8M4 1.2l5 3.8-5 3.8z" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M3 1.5v7M7 1.5v7" strokeWidth="1.4" />
  </Icon>
);

export const StepOverIcon = () => (
  <Icon>
    <path d="M1.5 5.5a3.5 3.5 0 017 0M8.5 2.5v3h-3" />
    <circle cx="5" cy="8.5" r="0.9" />
  </Icon>
);

export const StepIntoIcon = () => (
  <Icon>
    <path d="M5 0.5v5M2.8 3.5L5 5.7 7.2 3.5" />
    <circle cx="5" cy="8.5" r="0.9" />
  </Icon>
);

export const StepOutIcon = () => (
  <Icon>
    <path d="M5 6V0.8M2.8 3L5 0.8 7.2 3" />
    <circle cx="5" cy="8.5" r="0.9" />
  </Icon>
);

export const RestartIcon = () => (
  <Icon>
    <path d="M8.3 3.2A3.8 3.8 0 101 5.5M8.5 0.8v2.6H5.9" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="1.5" y="1.5" width="7" height="7" />
  </Icon>
);

// The TODO view in the IDE activity bar (18px): a checked list.
export const TodoIcon = () => (
  <Icon>
    <path
      d="M0.9 2.2l0.8 0.8 1.5-1.6M0.9 6.4l0.8 0.8 1.5-1.6M4.6 2.2h4.5M4.6 6.4h4.5M4.6 8.6h3"
      strokeWidth="0.7"
    />
  </Icon>
);

// IDE status bar (12px): CMake presets, kit, configure and build.
export const PresetIcon = () => (
  <Icon>
    <path
      d="M1 2.5h8M1 5h8M1 7.5h8M3.2 1.4v2.2M6.8 3.9v2.2M4.4 6.4v2.2"
      strokeWidth="0.8"
    />
  </Icon>
);

export const PackageIcon = () => (
  <Icon>
    <path
      d="M5 0.9l4 2.1v4L5 9.1 1 7V3zM1 3l4 2.1L9 3M5 5.1v4"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
  </Icon>
);

export const KitIcon = () => (
  <Icon>
    <path
      d="M0.9 3.6h8.2v5.2H0.9zM3.5 3.6V2.1h3v1.5M0.9 6h8.2M4.2 5.4v1.2h1.6V5.4"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
  </Icon>
);

export const GearIcon = () => (
  <Icon>
    <circle cx="5" cy="5" r="2.6" strokeWidth="0.8" />
    <circle cx="5" cy="5" r="1" strokeWidth="0.8" />
    <path
      d="M5 0.6v1.5M5 7.9v1.5M0.6 5h1.5M7.9 5h1.5M1.9 1.9l1.1 1.1M7 7l1.1 1.1M1.9 8.1L3 7M7 3l1.1-1.1"
      strokeWidth="1.1"
    />
  </Icon>
);

export const BuildIcon = () => (
  <Icon>
    <path
      d="M1.3 1.6h4.3l1.7 1.5v0.9H1.3zM3.5 4v5"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
    <path d="M3.5 4v5" strokeWidth="1.4" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="0.6" y="2.2" width="8.8" height="5.6" rx="0.8" strokeWidth="0.8" />
    <path
      d="M2.2 4h0.6M3.9 4h0.6M5.6 4h0.6M7.3 4h0.6M2.2 5.6h0.6M7.3 5.6h0.6M3.9 6.3h2.3"
      strokeWidth="0.8"
    />
  </Icon>
);
