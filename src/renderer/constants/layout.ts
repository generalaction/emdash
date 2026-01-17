/**
 * Layout constants for the application
 * Centralizes all layout-related configuration values
 */

// Panel layout configuration
export const TITLEBAR_HEIGHT = '36px';
export const PANEL_LAYOUT_STORAGE_KEY = 'emdash.layout.left-main-right.v2';
export const DEFAULT_PANEL_LAYOUT: [number, number, number] = [20, 60, 20];

// Left sidebar constraints
export const LEFT_SIDEBAR_MIN_SIZE = 16;
export const LEFT_SIDEBAR_MAX_SIZE = 30;

// Right sidebar constraints
export const RIGHT_SIDEBAR_MIN_SIZE = 16;
export const RIGHT_SIDEBAR_MAX_SIZE = 50;

// Main panel constraints
export const MAIN_PANEL_MIN_SIZE = 30;

// Storage keys
export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';
export const PROJECT_ORDER_KEY = 'sidebarProjectOrder';

/**
 * Clamps the left sidebar size to valid range
 */
export const clampLeftSidebarSize = (value: number): number =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[0], LEFT_SIDEBAR_MIN_SIZE),
    LEFT_SIDEBAR_MAX_SIZE
  );

/**
 * Clamps the right sidebar size to valid range
 */
export const clampRightSidebarSize = (value: number): number =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[2], RIGHT_SIDEBAR_MIN_SIZE),
    RIGHT_SIDEBAR_MAX_SIZE
  );