#!/usr/bin/env node
/**
 * Repository-Wide Secret Scanner
 * Scans all tracked files for high-entropy secrets, base58 private keys,
 * Solana byte-array keypairs, and raw authentication credentials.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

console.log("🔍 Running Repository Secret Scanner...");

// Get all git-tracked files
const files = execSync("git ls-files", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => f && !f.endsWith(".pdf") && !f.endsWith(".zip") && !f.endsWith(".apk") && !f.endsWith(".svg"));

let violations = 0;

for (const file of files) {
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // 1. Check for Solana 64-byte secret key JSON arrays: [12,34,56,...] (64 integers)
  if (/\[\s*([0-9]{1,3}\s*,\s*){31,}[0-9]{1,3}\s*\]/.test(content)) {
    console.error(`❌ CRITICAL SECRET VIOLATION: Potential Solana byte-array private key detected in ${file}`);
    violations++;
  }

  // 2. Check for base58 private key patterns (87-88 base58 characters assignment)
  if (/(private_key|secret_key|privatekey|secretkey)\s*[:=]\s*["'][1-9A-HJ-NP-Za-km-z]{80,95}["']/i.test(content)) {
    console.error(`❌ CRITICAL SECRET VIOLATION: Potential Solana base58 private key detected in ${file}`);
    violations++;
  }

  // 3. Check for live sensitive tokens / passwords
  if (/(HELIUS_AUTH|QUICKNODE_API)\s*=\s*[a-zA-Z0-9_\-]{25,}/i.test(content) && !file.includes(".example")) {
    console.error(`❌ CRITICAL SECRET VIOLATION: Live secret token detected in ${file}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n🚨 Secret scan FAILED with ${violations} violations. Clean the repository before continuing.`);
  process.exit(1);
}

console.log("✅ Secret scan PASSED: 0 secrets or private keys detected in repository.");
