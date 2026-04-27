#!/usr/bin/env node
// Migrate one wallet's v1 IQ Git data to the v2 layout.
//
//   SOLANA_RPC_ENDPOINT=...  \
//   SOLANA_KEYPAIR_PATH=/path/to/key.json \
//   SKIP_REPOS=iq-snake,iqlabs-docs \
//   npx tsx src/migrate.ts [--dry-run]
//
// Idempotent: re-running picks up where the previous run stopped (already-
// existing v2 entries are skipped). Read-only when --dry-run.
//
// What gets migrated:
//   • repo metadata           — v1 git_repos_v2_<owner>  → v2 git_repos_v2_<owner> (keccak)
//   • commit history per repo — v1 git_commits_<owner> filtered by repoName
//                                → v2 git_commits:<owner>:<repo>
//   • iqpages registration    — v1 iqpages-root/<owner>:<repo> table existence
//                                → v2 iqpages-root/deployed (single table) row
//   • blob/tree txIds         — re-referenced, not re-uploaded.

import { GitClient, readOwnerRepos } from "@iqlabs-official/git-sdk/node";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import iqlabs from "iqlabs-sdk";
import { loadCtx } from "./wallet.js";
import {
  isIqpagesDeployedV1,
  readAllCommits,
  readRepos,
  type V1Commit,
  type V1Repo,
} from "./v1.js";

const IQPAGES_ROOT = "iqpages-root";
const IQPAGES_TABLE = "deployed";
const IQPAGES_FEE_LAMPORTS = 200_000_000;
const IQPAGES_FEE_RECIPIENT = "EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1";
const PROGRAM_ID = new PublicKey(iqlabs.contract.DEFAULT_ANCHOR_PROGRAM_ID);

const dryRun = process.argv.includes("--dry-run");
const skipRepos = new Set(
  (process.env.SKIP_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

function plan(label: string, msg: string) {
  console.log(`${dryRun ? "[plan]" : "[ run]"} ${label.padEnd(8)} ${msg}`);
}

async function alreadyHasRepo(
  connection: Parameters<typeof readOwnerRepos>[0],
  owner: string,
  repo: string,
): Promise<boolean> {
  const repos = await readOwnerRepos(connection, owner);
  return repos.some((r) => r.name === repo);
}

async function alreadyDeployedV2(connection: Parameters<typeof readOwnerRepos>[0], owner: string, repo: string): Promise<boolean> {
  const rootSeed = iqlabs.utils.toSeedBytes(IQPAGES_ROOT);
  const tableSeed = iqlabs.utils.toSeedBytes(IQPAGES_TABLE);
  const dbRoot = iqlabs.contract.getDbRootPda(rootSeed, PROGRAM_ID);
  const tablePda = iqlabs.contract.getTablePda(dbRoot, tableSeed, PROGRAM_ID);
  if (!(await connection.getAccountInfo(tablePda))) return false;
  const rows = (await iqlabs.reader.readTableRows(tablePda)) as Array<{ id?: string }>;
  return rows.some((r) => r.id === `${owner}:${repo}`);
}

async function main() {
  const { connection, signer } = loadCtx();
  const owner = signer.publicKey.toBase58();
  console.log(`migrating v1 → v2 for ${owner}${dryRun ? " (dry-run)" : ""}`);
  console.log(`rpc: ${process.env.SOLANA_RPC_ENDPOINT}`);
  if (skipRepos.size) console.log(`skip: ${[...skipRepos].join(", ")}`);

  const client = new GitClient({ connection, signer });

  const allRepoRows = await readRepos(connection, owner);
  // v1 repos table is append-only — the same repo name can appear many times
  // if it was edited (e.g. visibility toggled). Keep only the newest row per
  // name so we migrate each repo exactly once.
  const reposByName = new Map<string, V1Repo>();
  for (const r of allRepoRows) {
    const prev = reposByName.get(r.name);
    if (!prev || (r.timestamp ?? 0) >= (prev.timestamp ?? 0)) {
      reposByName.set(r.name, r);
    }
  }
  const repos = [...reposByName.values()];
  console.log(`v1 repo rows: ${allRepoRows.length}, unique repos: ${repos.length}`);
  if (repos.length === 0) return;

  const allCommits = await readAllCommits(connection, owner);
  console.log(`v1 commit rows: ${allCommits.length}`);

  // Group commits by repo name and sort oldest-first so parentCommitId chains
  // line up when re-written into the new per-repo table.
  const commitsByRepo = new Map<string, V1Commit[]>();
  for (const c of allCommits) {
    if (!c.repoName) continue;
    const list = commitsByRepo.get(c.repoName) ?? [];
    list.push(c);
    commitsByRepo.set(c.repoName, list);
  }
  for (const list of commitsByRepo.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }

  for (const repo of repos as V1Repo[]) {
    if (skipRepos.has(repo.name)) {
      plan("skip", `${repo.name} (in SKIP_REPOS)`);
      continue;
    }

    console.log(`\n=== ${repo.name} (${repo.isPublic ? "public" : "private"}) ===`);

    // 1. repo metadata + commit table
    if (await alreadyHasRepo(connection, owner, repo.name)) {
      plan("skip", `repo ${repo.name} already in v2`);
    } else {
      plan("repo", `createRepo(${repo.name})`);
      if (!dryRun) {
        await client.createRepo({
          name: repo.name,
          description: repo.description ?? "",
          isPublic: !!repo.isPublic,
          timestamp: repo.timestamp ?? Date.now(),
        });
      }
    }

    // 2. commits — copy each row verbatim, only widening parentCommitId where
    // missing. txIds (treeTxId etc.) carry over so blobs are not re-uploaded.
    const commits = commitsByRepo.get(repo.name) ?? [];
    plan("commit", `${commits.length} rows to write`);
    if (!dryRun) {
      // Track which v2 commit ids exist already to keep re-runs idempotent.
      const existing = new Set((await client.log(owner, repo.name)).map((c) => c.id));
      for (const c of commits) {
        if (existing.has(c.id)) continue;
        await iqlabs.writer.writeRow(
          connection,
          signer,
          "iq-git-v1",
          `git_commits:${owner}:${repo.name}`,
          JSON.stringify({
            id: c.id,
            message: c.message,
            treeTxId: c.treeTxId,
            parentCommitId: c.parentCommitId,
            timestamp: c.timestamp,
            author: c.author ?? owner,
          }),
        );
      }
    }

    // 3. iqpages — if v1 had a per-repo marker table, register the repo in
    // the new single deployed table. Re-pays the fee because the v2 table is
    // a different account; the v1 marker table just stays as a zombie.
    if (await isIqpagesDeployedV1(connection, owner, repo.name)) {
      if (await alreadyDeployedV2(connection, owner, repo.name)) {
        plan("skip", `iqpages ${repo.name} already in v2 deployed table`);
      } else {
        plan("iqpages", `register ${repo.name} in v2 deployed table (+0.2 SOL fee)`);
        if (!dryRun) {
          await iqlabs.writer.writeRow(
            connection,
            signer,
            IQPAGES_ROOT,
            IQPAGES_TABLE,
            JSON.stringify({
              id: `${owner}:${repo.name}`,
              owner,
              repo: repo.name,
              deployedAt: Date.now(),
            }),
          );
          // Fee transfer (matches IqpagesService.deploy)
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: signer.publicKey,
              toPubkey: new PublicKey(IQPAGES_FEE_RECIPIENT),
              lamports: IQPAGES_FEE_LAMPORTS,
            }),
          );
          tx.feePayer = signer.publicKey;
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.partialSign(signer);
          const feeSig = await connection.sendRawTransaction(tx.serialize());
          await connection.confirmTransaction({ signature: feeSig, blockhash, lastValidBlockHeight });
        }
      }
    }
  }

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
