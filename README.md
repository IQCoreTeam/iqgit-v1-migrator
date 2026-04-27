# iqgit-v1-migrator

One-off CLI that migrates an IQ Git **v1** wallet's on-chain data into the
**v2** layout. Run it once from the wallet that owns the repos. Idempotent —
re-running picks up where the last run left off.

## Why migrate

| | v1 | v2 |
|---|---|---|
| Seed hash | sha256 (computed by the v1 frontend by hand) | keccak-256 (the iqlabs-sdk standard) |
| Commits | one mixed table per owner; rows tagged with `repoName` | per-repo table `git_commits:<owner>:<repo>` (writers locked to the owner) |
| iqpages | one table per repo under `iqpages-root` | one row per deployment in a single `iqpages-root/deployed` table |
| Blob/tree txIds | already on chain | re-referenced, **not re-uploaded** |

Without migrating, v2 readers can't see your v1 repos — the PDA derivation
is different. Migration creates the new tables (small rent) and re-writes
your existing commits as new rows pointing at the **same** blob/tree
transactions you've already paid for, so no big chunks get re-uploaded.

## What you need

- A Node.js install (Node 20+ works; see `package.json` engines).
- Your Solana keypair JSON file — the one that owns your v1 repos.
  - **Never commit this file.** `.gitignore` blocks `keypair.json` and
    `*-keypair.json` by default; keep it outside the repo if you can.
- A Solana RPC endpoint with read access. A regular Helius mainnet URL is
  fine; the public `https://api.mainnet-beta.solana.com` will rate-limit you
  hard, so prefer a private RPC.

## Step-by-step

```bash
git clone https://github.com/IQCoreTeam/iqgit-v1-migrator
cd iqgit-v1-migrator
npm install
```

### 1. Dry-run first

```bash
SOLANA_RPC_ENDPOINT="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" \
  SOLANA_KEYPAIR_PATH="/path/to/your/wallet.json" \
  npx tsx src/migrate.ts --dry-run
```

The dry-run prints a plan — repo by repo — without sending any transactions.
Read it. If something's wrong (a repo you don't actually want to migrate,
a v1 leftover that should stay buried, etc.), use `SKIP_REPOS` to exclude
it and re-run:

```bash
SOLANA_RPC_ENDPOINT="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" \
  SOLANA_KEYPAIR_PATH="/path/to/your/wallet.json" \
  SKIP_REPOS="old-repo,another-old-repo" \
  npx tsx src/migrate.ts --dry-run
```

### 2. Run for real

When the plan looks right, drop `--dry-run`:

```bash
SOLANA_RPC_ENDPOINT="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" \
  SOLANA_KEYPAIR_PATH="/path/to/your/wallet.json" \
  SKIP_REPOS="old-repo" \
  npx tsx src/migrate.ts
```

You'll see each repo migrate in turn:
- `[ run] repo     createRepo(<name>)` — adds the repo to your v2 list
- `[ run] commit   N rows to write` — re-writes commit rows to the new
  per-repo table; `N` matches your v1 commit count
- `[ run] iqpages  register <name> in v2 deployed table (+0.2 SOL fee)` —
  if the repo was deployed as iqpages in v1, the marker is migrated

If it stops mid-way (network blip, RPC blip, whatever), just re-run with
the same env vars. Already-migrated rows are detected and skipped.

## Cost

- A small rent deposit for each new on-chain table (~0.002 SOL each).
- One write fee per re-written commit row (~0.00001 SOL each).
- 0.2 SOL one-time per iqpages deployment that gets migrated.

For a wallet with two repos and a few dozen commits, expect well under
0.5 SOL total — most of it is iqpages fees.

## Configuration reference

| env var | required? | meaning |
|---|---|---|
| `SOLANA_RPC_ENDPOINT` | yes | RPC URL the script reads + writes through |
| `SOLANA_KEYPAIR_PATH` | yes (unless a `keypair.json` is in cwd or at `~/.config/solana/id.json`) | path to your wallet's secret key json |
| `SKIP_REPOS` | no | comma-separated repo names to leave alone (e.g. `iq-snake,old-test`) |

Flags:

| flag | meaning |
|---|---|
| `--dry-run` | print the plan, send zero transactions |

## What the script touches

For each v1 repo (excluding `SKIP_REPOS`):

1. **`createRepo` in v2** if the repo isn't already there. Pre-creates the
   per-repo commit table at `git_commits:<owner>:<repo>`.
2. **Re-writes each v1 commit row** into that v2 table, oldest first.
   Keeps the original `id`, `parentCommitId`, `treeTxId`, `timestamp`, and
   `author` — your blob/tree transactions are reused as-is.
3. **iqpages registration** — if the repo had a v1 iqpages marker table,
   the migrator adds one row to `iqpages-root/deployed` and pays the 0.2
   SOL fee.

What it does **not** do:
- Re-upload blobs, trees, or files. Everything content-addressed stays where it is.
- Touch repos in `SKIP_REPOS`.
- Delete v1 leftovers. v1 iqpages tables remain on chain as zombies; v2 readers ignore them.

## Sanity checklist

- [ ] Wallet has a few SOL spare (commits + table rent + any iqpages fees).
- [ ] You're using a private RPC, not the public mainnet URL.
- [ ] Did a `--dry-run` first, read the output, and the plan matches what you expect.
- [ ] Ran from the wallet that **owns** the repos.

## Troubleshooting

- **`401 Unauthorized` from Helius** — your IP isn't on that key's allowlist.
  Add it in the Helius dashboard, or use a different RPC.
- **`429 Too Many Requests`** — public RPC throttling. Wait a minute or
  switch to a private RPC.
- **`already deployed: <owner>:<repo>`** — that repo's iqpages marker is
  already in `iqpages-root/deployed`. The migrator skips it on re-runs;
  this message means it's done, not failing.

## License

MIT
