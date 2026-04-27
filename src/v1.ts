// v1 on-chain layout reader.
//
// v1 frontend (services/git/git-chain-service.ts in on-chaingit-frontend before
// the v2 cutover) computed table seeds with `sha256(name + "_" + owner)` for
// owner-scoped tables and `sha256("iq-git-v1")` for the DbRoot. iqlabs-sdk's
// `toSeedBytes` switched to keccak-256 for the v2 family, so we replicate the
// old sha256 path here only — read-only.

import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2";
import iqlabs from "iqlabs-sdk";

const ROOT_ID = "iq-git-v1";

export const REPOS_TABLE = "git_repos_v2";
export const COMMITS_TABLE = "git_commits";
export const IQPAGES_ROOT = "iqpages-root";

const PROGRAM_ID = new PublicKey(iqlabs.contract.DEFAULT_ANCHOR_PROGRAM_ID);

function sha256buf(s: string): Buffer {
  return Buffer.from(sha256(Buffer.from(s, "utf8")));
}

const dbRoot = (() => iqlabs.contract.getDbRootPda(sha256buf(ROOT_ID), PROGRAM_ID))();

function tablePda(seedBytes: Buffer): PublicKey {
  return iqlabs.contract.getTablePda(dbRoot, seedBytes, PROGRAM_ID);
}

export interface V1Repo {
  name: string;
  description: string;
  owner: string;
  timestamp: number;
  isPublic: boolean;
}

export interface V1Commit {
  id: string;
  repoName: string;
  message: string;
  author: string;
  timestamp: number;
  treeTxId: string;
  parentCommitId?: string;
}

/** Read all repos owned by `owner` from the v1 layout. */
export async function readRepos(connection: Connection, owner: string): Promise<V1Repo[]> {
  const pda = tablePda(sha256buf(`${REPOS_TABLE}_${owner}`));
  if (!(await connection.getAccountInfo(pda))) return [];
  return (await iqlabs.reader.readTableRows(pda)) as unknown as V1Repo[];
}

/** Read every v1 commit row across all of `owner`'s repos (single mixed table). */
export async function readAllCommits(connection: Connection, owner: string): Promise<V1Commit[]> {
  const pda = tablePda(sha256buf(`${COMMITS_TABLE}_${owner}`));
  if (!(await connection.getAccountInfo(pda))) return [];
  return (await iqlabs.reader.readTableRows(pda)) as unknown as V1Commit[];
}

/** Whether v1 iqpages table exists for <owner>:<repo>. v1 used keccak via
 *  `toSeedBytes(<owner>:<repo>)` for the iqpages namespace specifically — that
 *  one path was already on the v2 hashing scheme. */
export async function isIqpagesDeployedV1(
  connection: Connection,
  owner: string,
  repoName: string,
): Promise<boolean> {
  const iqpRoot = iqlabs.contract.getDbRootPda(
    iqlabs.utils.toSeedBytes(IQPAGES_ROOT),
    PROGRAM_ID,
  );
  const seed = iqlabs.utils.toSeedBytes(`${owner}:${repoName}`);
  const pda = iqlabs.contract.getTablePda(iqpRoot, seed, PROGRAM_ID);
  return (await connection.getAccountInfo(pda)) !== null;
}
