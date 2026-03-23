/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {};

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences;

declare namespace Preferences {
  /** Preferences accessible in the `search-projects` command */
  export type SearchProjects = ExtensionPreferences & {};
  /** Preferences accessible in the `recent-projects` command */
  export type RecentProjects = ExtensionPreferences & {};
  /** Preferences accessible in the `tasks` command */
  export type Tasks = ExtensionPreferences & {};
  /** Preferences accessible in the `ssh-connections` command */
  export type SshConnections = ExtensionPreferences & {};
}

declare namespace Arguments {
  /** Arguments passed to the `search-projects` command */
  export type SearchProjects = {};
  /** Arguments passed to the `recent-projects` command */
  export type RecentProjects = {};
  /** Arguments passed to the `tasks` command */
  export type Tasks = {};
  /** Arguments passed to the `ssh-connections` command */
  export type SshConnections = {};
}
