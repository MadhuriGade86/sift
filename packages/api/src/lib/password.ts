// packages/api/src/lib/password.ts
//
// Argon2id hashing per plan.md A1 / handbook Auth & Access requirements.
// Never call the argon2 library directly from route handlers — always
// go through this wrapper so hashing parameters stay centralized.

import argon2 from "argon2";

// OWASP-recommended baseline for Argon2id as of this writing: 19 MiB memory,
// 2 iterations, 1 degree of parallelism is the *minimum* acceptable profile.
// We go somewhat above the floor since this runs in a serverless function
// with generous default memory, and hashing cost is what actually protects
// against offline cracking if the DB is ever exfiltrated.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // argon2.verify throws on a malformed hash rather than returning false —
    // normalize that to "verification failed" so callers have one code path.
    return false;
  }
}
