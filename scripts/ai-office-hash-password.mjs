#!/usr/bin/env node
// Local-only dev tool: generates the OFFICE_OWNER_PASSWORD_HASH value for
// .env.local. Never run this against a value you want kept secret in your
// shell history — pass the password as an argument only on your own
// machine. See docs/ai-office/08-security-plan.md §1.
//
// Usage: node scripts/ai-office-hash-password.mjs "your-password-here"

import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/ai-office-hash-password.mjs \"your-password-here\"");
  process.exit(1);
}

const KEY_LENGTH = 64; // must match SCRYPT_KEY_LENGTH in lib/ai-office/auth/credentials.ts
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");

console.log("\nAdd this to .env.local as OFFICE_OWNER_PASSWORD_HASH:\n");
console.log(`${salt}:${hash}`);
console.log("");
