# iqgit-v1-migrator — TODO

글로벌 투두: [../iq-git-cli/IQGIT-V2-TODO.md](../iq-git-cli/IQGIT-V2-TODO.md)

---

## 선행 조건

- [ ] `@iqlabs/git` 0.1.0-rc.1 publish 또는 `npm link`

## 스캐폴딩

- [ ] `git init` + `npm init`
- [ ] `package.json`
  - [ ] `dependencies`: `@iqlabs/git`, `iqlabs-sdk`, `@solana/web3.js`, `commander`
  - [ ] `bin`: `iqgit-v1-migrator`
- [ ] `tsconfig.json`
- [ ] eslint (`CODE-RULES.md` 적용)

## 구현

- [ ] `src/util/keypair.ts` — 로컬 json keypair 로더
- [ ] `src/util/log.ts` — 진행 로그 포맷 (레포별 진행/완료/실패 구분)
- [ ] `src/v1-reader.ts` — `git_commits_<owner>` 직접 조회 (iqlabs-sdk 만 사용)
- [ ] `src/migrate.ts` — 메인 흐름
  - [ ] byRepo 그룹핑
  - [ ] `GitClient.ensureCommitTable(repo)` 호출
  - [ ] commit 시간순 writeRow, parentCommitId 복원
  - [ ] public 이면 `registerPublicRepo`
  - [ ] 마지막 treeTxId 일치 검증
- [ ] `src/bin.ts` — commander
  - [ ] `migrate <keypair>`
  - [ ] `dry-run <keypair>` — 쓰기 생략 + 예상 비용 출력
  - [ ] `verify <keypair>` — 이관 후 재검증

## 실행 대상 (현재 확인됨)

- owner `FPSYQmFh1WhbrgNKoQCDBcrf3YLc9eoNCpTyAjHXrf1c`
  - `iq-snake`
  - `poiqemon`
- keypair: `~/Desktop/deploy/deploy.json`

추가 유저 deploy 발견 시 실행 대상에 추가.

## 실행

- [ ] `dry-run` 먼저 → 결과 검토
- [ ] 실제 `migrate` 실행
- [ ] `verify` 로 재확인
- [ ] 프론트 재배선 (Phase 4) 전에 완료 필수

## 폐기

- [ ] 모든 owner 의 데이터 이관 완료 후 archive 처리 (repo 자체는 남겨 히스토리 보존)
