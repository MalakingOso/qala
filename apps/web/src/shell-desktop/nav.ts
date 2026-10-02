/* Desktop navigation: two numbered groups plus Settings pinned below. The
 * numbers are part of the look (DECISIONS U21), so they live with the ids. */

export interface NavItem {
  id: string;
  label: string;
  no: string;
}

export const TRAINING_NAV: NavItem[] = [
  { id: "overview", label: "Overview", no: "01" },
  { id: "lifts", label: "Lifts", no: "02" },
  { id: "running", label: "Running", no: "03" },
  { id: "body", label: "Body", no: "04" },
  { id: "history", label: "History", no: "05" },
];

export const WORKSPACE_NAV: NavItem[] = [
  { id: "programs", label: "Programs", no: "06" },
  { id: "exercises", label: "Exercises", no: "07" },
  { id: "memory", label: "Coach memory", no: "08" },
  { id: "calibration", label: "Calibration", no: "09" },
];

export const ALL_NAV: NavItem[] = [
  ...TRAINING_NAV,
  ...WORKSPACE_NAV,
  { id: "settings", label: "Settings", no: "" },
];
