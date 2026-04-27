// Keypair + connection loader. Same resolution order as iq-git CLI:
//   1. ./keypair.json in cwd
//   2. $SOLANA_KEYPAIR_PATH
//   3. ~/.config/solana/id.json
// RPC from SOLANA_RPC_ENDPOINT (no fallback — migration must be explicit).

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";

function resolveKeypairPath(): string {
  const local = path.join(process.cwd(), "keypair.json");
  if (fs.existsSync(local)) return local;
  if (process.env.SOLANA_KEYPAIR_PATH) return process.env.SOLANA_KEYPAIR_PATH;
  return path.join(os.homedir(), ".config", "solana", "id.json");
}

export function loadCtx(): { connection: Connection; signer: Keypair } {
  const rpc = process.env.SOLANA_RPC_ENDPOINT;
  if (!rpc) {
    throw new Error("SOLANA_RPC_ENDPOINT is required (set to mainnet or devnet URL).");
  }
  const keypairPath = resolveKeypairPath();
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found: ${keypairPath}`);
  }
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  if (!Array.isArray(secret)) {
    throw new Error(`Invalid keypair file: ${keypairPath}`);
  }
  return {
    connection: new Connection(rpc, "confirmed"),
    signer: Keypair.fromSecretKey(Uint8Array.from(secret)),
  };
}
