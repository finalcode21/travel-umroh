export * from "./enums";
export * from "./core";

import { sessions, users } from "./core";

/** Inferred row types for the session and user tables. */
export type Sessions = typeof sessions.$inferSelect;
export type Users = typeof users.$inferSelect;