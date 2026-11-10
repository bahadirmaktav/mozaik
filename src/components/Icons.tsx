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

/** A floating panel going back into the layout: a window settling into its frame. */
export const DockIcon = () => (
  <Icon>
    <rect x="0.5" y="0.5" width="9" height="9" />
    <path d="M0.5 6.5h9M5 1.5v3.5M3.5 3.5L5 5l1.5-1.5" />
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

/** A file with a plus: create a file (a note), as in a file explorer's header. */
export const NewFileIcon = () => (
  <Icon>
    <path d="M5 9.5H1.5v-9h4l2 2V5M5.5 0.5v2h2M7.5 6v3.5M5.75 7.75h3.5" />
  </Icon>
);

/** A folder with a plus: create a folder (a group). */
export const NewFolderIcon = () => (
  <Icon>
    <path d="M5 8.5H0.5v-7h3l1 1h5V5M7.5 6v3.5M5.75 7.75h3.5" />
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

/** A person, for the commit authors of the Source Control graph. */
export const AuthorIcon = () => (
  <Icon>
    <circle cx="5" cy="3.2" r="1.9" strokeWidth="0.8" />
    <path d="M1.4 9.2c0.4-2 1.8-3 3.6-3s3.2 1 3.6 3" strokeWidth="0.8" />
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

/** A frame divided in two: split into side-by-side views. */
export const SplitIcon = () => (
  <Icon>
    <rect x="0.5" y="0.5" width="9" height="9" />
    <path d="M5 0.5v9" />
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

// The Testing view in the IDE activity bar (18px): a flask.
export const TestIcon = () => (
  <Icon>
    <path
      d="M3.6 0.8h2.8M4 0.8v3.1L1.3 8.4a0.6 0.6 0 000.5 0.8h6.4a0.6 0.6 0 000.5-0.8L6 3.9V0.8M2.4 6.6h5.2"
      strokeWidth="0.7"
      strokeLinejoin="round"
    />
  </Icon>
);

// The Coverage view in the IDE activity bar: a share of a circle.
export const CoverageIcon = () => (
  <Icon>
    <circle cx="5" cy="5" r="4.1" strokeWidth="0.7" />
    <path
      d="M5 5V0.9A4.1 4.1 0 018.55 7.05z"
      fill="currentColor"
      stroke="none"
    />
  </Icon>
);

// The SonarQube view in the IDE activity bar: arcs of a signal over a point.
export const SonarIcon = () => (
  <Icon>
    <path
      d="M1.6 8.6a5.6 5.6 0 015.6-5.6M1.6 5.9A2.9 2.9 0 014.5 3M1.3 0.9a8 8 0 017.8 7.8"
      strokeWidth="0.7"
      strokeLinecap="round"
    />
    <circle cx="1.8" cy="8.4" r="0.8" fill="currentColor" stroke="none" />
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

/** A drive: a disk box with its light, for the This PC page. */
export const DriveIcon = () => (
  <Icon>
    <rect x="0.5" y="2.5" width="9" height="5" rx="1" />
    <path d="M7 5h0.8" strokeWidth="1.2" />
  </Icon>
);

/** This PC: a screen on its stand. */
export const ComputerIcon = () => (
  <Icon>
    <rect x="0.5" y="1" width="9" height="6" rx="0.5" />
    <path d="M3.5 9h3M5 7v2" />
  </Icon>
);

/** A circular arrow: refresh. */
export const RefreshIcon = () => (
  <Icon>
    <path d="M8.5 5a3.5 3.5 0 1 1-1-2.5M7.5 0.8v1.9H5.6" />
  </Icon>
);

/** Boxes folding up: collapse every folder. */
/** A file behind a slash: files Git ignores. */
export const IgnoredFilesIcon = () => (
  <Icon>
    <path d="M2 0.5h4l2 2v7H2zM0.5 8.5l9-7" />
  </Icon>
);

/** Text with a bar under it and an arrow: replace every match. */
export const ReplaceAllIcon = () => (
  <Icon>
    <path d="M0.5 1.5h6M0.5 4h4M6.5 3.5v3.5H3M4.5 5.5L3 7l1.5 1.5" />
  </Icon>
);

/** Lines swept away: clears a list of results, as in VS Code. */
export const ClearAllIcon = () => (
  <Icon>
    <path d="M0.5 2.5h6M0.5 5h4M0.5 7.5h3M5.5 5.5l4 3.5M9.5 5.5l-4 3.5" />
  </Icon>
);

export const CollapseAllIcon = () => (
  <Icon>
    <path d="M2.5 2.5h6v6M0.5 4.5h6v5h-6zM2 7h3" />
  </Icon>
);
