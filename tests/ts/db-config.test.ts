import { describe, it, expect } from "vitest";
import { isPersistentDbConfigured } from "@/lib/db";

describe("production DB guard", () => {
  it("returns false when a Vercel deployment has no shared persistent DB configured", () => {
    const oldVercel = process.env.VERCEL;
    const oldDbPath = process.env.DB_PATH;
    const oldDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.VERCEL = "1";
      delete process.env.DB_PATH;
      delete process.env.DATABASE_URL;
      expect(isPersistentDbConfigured()).toBe(false);
    } finally {
      if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
      if (oldDbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = oldDbPath;
      if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabaseUrl;
    }
  });

  it("returns true when a shared database path is configured", () => {
    const oldVercel = process.env.VERCEL;
    const oldDbPath = process.env.DB_PATH;
    const oldDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.VERCEL = "1";
      process.env.DB_PATH = "/var/lib/interview-coach/coach.db";
      delete process.env.DATABASE_URL;
      expect(isPersistentDbConfigured()).toBe(true);
    } finally {
      if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
      if (oldDbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = oldDbPath;
      if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabaseUrl;
    }
  });
});
