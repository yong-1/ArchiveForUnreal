# NextFlix Archive 온보딩

이 문서는 프로젝트에 처음 합류한 개발자가 첫날 로컬에서 실행하고, 구조를 이해하고, 안전하게 첫 변경을 올리기까지 필요한 내용을 모은 것이다. 설계 근거는 [SDD](docs/SDD.ko.md)·[TDD](docs/TDD.ko.md)(현행 v6.2, v6.1 이력은 `docs/history/`), 구현 현황은 [IMPLEMENTATION](docs/IMPLEMENTATION.ko.md), 운영 시험은 [운영 체크리스트](docs/OPERATIONS-CHECKLIST.ko.md)에 있다.

## 1. 이 프로젝트가 하는 일

방송 제작팀(약 10명, 약 10TB)이 만든 **제작 결과물(영상·이미지)** 과 그것을 다시 편집할 수 있는 **제작 소스(FBX·이미지·기타 파일·Unreal 프로젝트)** 를 별도 NAS에 보존하고, Netflix 같은 화면에서 찾아 내려받게 한다.

사용자 흐름은 하나다: **결과물 찾기 → 필요하면 연결 소스 확인 → 정확한 버전 다운로드.**

반드시 지켜야 하는 원칙(릴리스 차단 조건, B0):

| 원칙 | 코드에서 보장하는 곳 |
| --- | --- |
| 제작 원본 PC/NAS는 읽기 전용. 생성·수정·삭제 0 | `sources.ts`(읽기만), 삭제는 ARCHIVE/PREVIEW/STAGING 루트만 |
| 공개된 버전의 파일·manifest·소스 연결은 바꾸지 않는다. 변경은 항상 새 버전 | DB trigger(`*_guard`), `uploads.ts` overlay |
| 검증 전에는 '보존 완료'·'공개'·'삭제 완료'를 표시하지 않는다 | `processCommit`의 마지막 트랜잭션, `processDelete`의 부재 확인 |
| 권한 밖 자료는 존재 여부도 노출하지 않는다(404) | `access.ts`의 `itemAccess`/`projectAccess` |
| 공유 소스는 삭제하지 않고 연결만 해제 | `deletions.ts`의 `computePlan` |

## 2. 첫날: 로컬 실행 (Windows PowerShell 기준)

준비물: Node.js 22 이상(팀 검증: Node 24), Git. Docker는 운영형 PostgreSQL을 쓸 때만 필요하다.

~~~powershell
npm ci                 # postinstall에서 prisma generate 실행
npm run dev:local      # PGlite DB + .local 저장소 + 웹 안의 worker
~~~

1. 로그에 나온 `.local/dev-secrets.json`의 `bootstrap` 값을 복사한다.
2. http://localhost:3000/auth 에서 초기 설정 키, 관리자 계정, 팀 이름을 입력한다. 데모 계정은 없다.
3. **제작 건** 메뉴에서 제작 건을 만든 뒤 **등록**으로 PNG 하나와 FBX 하나를 올려 본다.
4. 카드 → 상세 → '연결된 제작 소스' 펼치기 → 원본 다운로드까지 해 보면 전체 흐름을 한 번 지나간 것이다.

주의:

- `dev:local`의 DB는 PGlite(단일 프로세스용 PostgreSQL 호환 DB)다. 이 상태에서 `npm run worker`나 다른 Prisma 프로세스를 같이 띄우지 않는다.
- 데이터 위치를 바꾸려면 `LOCAL_DATA_ROOT`, 포트는 `PORT`/`LOCAL_DB_PORT`.
- 처음부터 다시 하려면 서버를 끄고 `.local` 안의 `postgres`, `archive`, `staging`, `preview`, `dev-secrets.json`을 지운다(실제 NAS 경로가 아닌지 먼저 확인).
- 이 저장소의 Next.js는 16.x다. 학습 데이터 기준의 Next.js 관행과 다를 수 있으므로 [AGENTS.md](AGENTS.md) 안내대로 `node_modules/next/dist/docs/`를 확인한다.

## 3. 저장소 구조

~~~text
app/
  archive/[[...path]]/page.tsx   모든 /archive/* 화면의 진입점(클라이언트 라우팅은 ArchiveApp)
  api/archive/[...path]/route.ts 모든 /api/archive/* 요청 → lib/archive/api.ts dispatch
  auth/page.tsx                  로그인·초기 설정
  api/movies, random, favorite   예전 영화 API 자리. 410만 반환(호환용)
components/archive/
  ArchiveApp.tsx   상단 메뉴와 화면 분기(segments)
  Library.tsx      홈 카드·검색·필터(URL에 상태 저장)
  ItemDetail.tsx   상세, 버전 선택, 연결 소스, 삭제창
  History.tsx      버전 설명·메모 이력, 역탐색(used-by), 정보 수정 이력
  UploadPage.tsx   등록/수정 폼 → Transfer.tsx(청크 전송) → PlanPanel.tsx(포함/제외/검토)
  Overview.tsx     제작 건 상세, Unreal 보존 상세, 관리자 무결성 패널
  Management.tsx   작업 관리, 제작 건 목록, 팀 설정
lib/archive/       서버 도메인 로직(아래 4장)
prisma/            schema.prisma + 손으로 작성한 SQL migration
scripts/           dev:local, worker, maintenance, PGlite 시작
tests/             단위(tests/*.test.ts), 통합(tests/integration), HTTP 스모크(tests/http)
e2e/               Playwright 브라우저 시나리오
docs/              SDD/TDD/구현 기록/운영 체크리스트
~~~

## 4. 서버 코드 지도 (`lib/archive`)

| 파일 | 역할 |
| --- | --- |
| `api.ts` | 경로·메서드별 분기. 새 API는 여기에 `is('GET','items','*',...)` 형태로 추가 |
| `http.ts` | JSON 응답(BigInt→문자열), same-origin 검사, 오류→HTTP 상태 매핑 |
| `errors.ts` | `ArchiveError(status, code, message)`와 `check()` |
| `access.ts` | 현재 사용자(Actor), 팀/제작 건/행위(VIEW·DOWNLOAD·EDIT·DELETE) 권한 |
| `db.ts` | Prisma 클라이언트, `serial()` 트랜잭션, `lock()`(SELECT … FOR UPDATE) |
| `catalog.ts` | 목록·검색·상세, 메타데이터 저장, 이력·역탐색·버전 설명·메모 수정 |
| `uploads.ts` | 업로드 묶음·청크·overlay 계획·확정(`processCommit`) |
| `signature.ts` | 확장자별 매직 바이트 검사(첫 청크) |
| `policy.ts` | Unreal 포함/제외/검토 규칙과 정책 설명 |
| `sources.ts` | 승인된 원본 NAS 조사(읽기 전용)·가져오기 |
| `storage.ts` | 불변 객체 쓰기(`putObject`), lease, 참조 없는 객체 회수 |
| `manifest.ts` | NAS manifest 해시·DB 파일 목록 대조 |
| `downloads.ts` | 단일 파일 Range/ETag 스트리밍, ZIP 준비 |
| `restores.ts` | 새 작업 공간 복원(덮어쓰기 금지·공간 검사) |
| `deletions.ts` | 삭제 계획(전용/공유 판정)·확인·물리 삭제·취소 |
| `previews.ts` | AV1 WebM·WebP 파생물 생성(FFmpeg/Sharp) |
| `maintenance.ts` | 만료 업로드·ZIP·draft 정리, 저장소 상태, 무결성 점검 |
| `overview.ts` | 제작 건 상세, Unreal 보존 범위 통계 |
| `worker.ts` | DB job 큐 처리(lease/fence), 진행률·job_events 기록 |

## 5. 핵심 개념

**항목·버전·보존본·객체**

~~~text
archive_items (논리 항목: 제목·연도·kind·roles·lifecycle·대표 버전)
  └ item_versions (v1, v2… DRAFT→READY, 설명/설명 이력)
      ├ item_links (이 버전이 연결한 소스 버전, ASSOCIATED/USED_CONFIRMED)
      └ archive_versions (보존본 1개: manifest 해시·파일 수·VERIFIED)
          └ archive_files (상대경로 → storage_object)
                └ storage_objects (NAS의 불변 파일 1개. 여러 버전이 공유 가능)
~~~

- **kind**: VIDEO/IMAGE/MODEL3D/FILE/UNREAL_PROJECT. **roles**: RESULT/SOURCE/REFERENCE.
- **버전 번호는 서버가 매긴다.** 업로드 묶음 하나를 확정할 때마다 vNext. 설명만 바꾸면 버전이 늘지 않는다.
- **overlay**: 수정 업로드에서 같은 정규화 상대경로(NFC·대소문자 무시)는 교체, 새 경로는 추가, 보내지 않은 파일은 같은 객체를 승계, 명시한 경로만 제거.
- **lifecycle**: ACTIVE → DELETE_PENDING(안 보임·새 제공 중지) → DELETED(물리 삭제 확인 후).
- **lease**: 다운로드·복원·확정 중인 객체에 거는 짧은 사용권. 삭제·정리는 활성 lease가 있으면 기다린다.
- **job**: COMMIT·PREVIEW·DOWNLOAD·SCAN·IMPORT·RESTORE·DELETE·MAINTENANCE. 같은 대상의 활성 작업은 하나(`one_active_job` 인덱스). worker는 `fence` 값으로 소유권을 확인한다.

**업로드 한 번의 흐름**

1. `POST items`(메타데이터) → `POST upload-batches`(파일 목록·기준 버전·멱등 키) → 서버가 plan(포함/제외/검토, 교체/추가/승계/제거)을 만든다.
2. 브라우저가 파일 SHA-256 등록 → 8MiB 청크 `PUT uploads/{id}/parts/{n}` → `complete`.
3. `POST upload-batches/{id}/commit`(planHash 확인) → COMMIT job.
4. worker: staging 청크 → 보존 NAS 객체(해시 재계산) → manifest → **짧은 트랜잭션 하나에서** 버전 번호·대표 버전·소스 연결·감사 기록을 함께 확정.

**삭제 한 번의 흐름**: `delete-plans`(범위·공유 판정·hash) → 사용자 확인 `delete-requests`(같은 hash 재계산 후 DELETE_PENDING) → DELETE job이 객체별로 실제 참조와 lease를 다시 확인하고 파일을 지운 뒤 부재를 확인한다. 실패는 PARTIAL, 재시도는 같은 요청으로 한다.

## 6. 테스트

~~~powershell
npm run lint
npm run typecheck
npm test                    # 단위: 경로, UE 정책, Range, canonical JSON, 파일 signature
npm run test:integration    # 통합: PGlite + 임시 폴더, 실제 FFmpeg/Sharp 실행
npx playwright install chromium   # E2E 최초 1회
npm run test:e2e            # 브라우저 E2E: 격리 개발 서버를 직접 띄움
npm run build
~~~

- 통합 시험은 파일마다 다른 PGlite 포트를 쓴다(archive 55439, b0 55441, operations 55443). 새 파일을 추가하면 겹치지 않는 포트를 고른다. 공통 준비는 `tests/integration/setup.ts`의 `createHarness(port)`를 쓴다.
- 업로드 fixture는 **확장자에 맞는 매직 바이트**가 있어야 한다(`.png`는 PNG 헤더, `.fbx`는 `; FBX …` 등). 아니면 415 SIGNATURE_MISMATCH.
- E2E는 실행마다 `.local/qa-e2e-<시각>`에 DB·저장소·리포트를 만든다. 쌓인 폴더는 수시로 지운다. 포트는 `E2E_PORT`(3100)·`E2E_DB_PORT`(55460).
- TDD 사례 ID(DEL-03, UPL-07 …)를 테스트 이름 앞에 붙인다. 실제 SMB·UE·백업 시험은 자동 시험으로 대체하지 않고 운영 체크리스트에 기록한다.

## 7. 코드 규칙

- **오류**: 사용자에게 보일 수 있는 실패는 `check(cond, status, 'CODE', '한국어 메시지')`. 코드 값은 테스트가 `{code:'...'}`로 검사하므로 바꿀 때 테스트도 고친다. 400 입력·403 행위 권한·404 없음/비공개·409 경쟁/revision·410 삭제·만료·413·415·416·503 저장소.
- **권한**: 서버의 모든 진입점에서 `itemAccess`/`projectAccess`를 먼저 부른다. 목록은 권한 범위를 먼저 적용한 뒤 집계한다. 권한 밖 이름은 노출하지 않는다.
- **트랜잭션과 잠금**: 여러 항목을 잠글 때는 ID 정렬 순서로 `lock()`. 긴 NAS 작업은 트랜잭션 밖에서, 상태 확정만 짧은 `serial()` 안에서 한다.
- **멱등성**: 업로드·삭제 확인은 `requestKey`, 청크는 `(session, partNo)`, 객체는 미리 정한 UUID로 재실행해도 같은 결과가 나와야 한다.
- **BigInt**: 크기·버전 번호는 BigInt, API에서는 10진 문자열. JSON에 넣을 때 `asJson()`.
- **경로**: 사용자 경로는 항상 `relativePath()`로 검증하고, 실제 파일 접근은 `safePath(root, key)`로만 한다. NAS 경로 문자열로 재귀 삭제하지 않는다.
- **DB 변경**: `schema.prisma`와 **같은 내용의 SQL migration을 새 폴더로 추가**한다(`prisma/migrations/<YYYYMMDDhhmmss>_<이름>/migration.sql`). 이미 적용된 migration 파일은 수정하지 않는다. 상태 열에는 CHECK를, 보호 대상 FK에는 RESTRICT를 둔다. DB CASCADE로 NAS 파일을 지우지 않는다. 작성 후 빈 DB에서 `prisma migrate diff --from-migrations … --to-schema-datamodel …`로 차이가 없는지 확인한다.
- **불변 trigger 주의**: `archive_files`·`item_links`의 BEFORE DELETE trigger는 보호 대상이 아니어도 행을 지우지 않는다. 정리 코드는 DELETE 대신 `active=false`나 상태 변경을 쓴다.
- **UI**: 상태는 URL(검색·필터·버전)에 두고, 브라우저 저장소에 업무 상태를 넣지 않는다. 키보드 접근(라벨·aria)을 유지하고 E2E가 라벨로 요소를 찾는다.
- 기존 코드는 한 줄이 긴 밀집 스타일이다. 새 파일은 읽기 쉬운 길이로 써도 되지만 한 파일 안에서는 주변 스타일을 따른다.

## 8. 자주 하는 작업

**API 추가**: `lib/archive/<도메인>.ts`에 함수(권한 검사 포함) → `api.ts`에 경로 추가(GET은 부작용 없게, 변경은 same-origin 검사가 자동 적용) → 통합 테스트 → 필요하면 `components/archive/types.ts`와 화면.

**job 종류 추가**: migration에서 `job_type` CHECK 확장 → `worker.ts` 분기 → `api.ts`의 `jobAccess`에 권한 규칙 → `Management.tsx`의 `jobNames`.

**운영 정리 즉시 실행**: `npm run maintenance`(팀별로 정리·무결성 점검 1회). 평소에는 worker가 `MAINTENANCE_INTERVAL_MINUTES`(기본 60) 간격으로 예약한다. 점검 결과는 팀 설정 → '보존 무결성·정리'.

## 9. 운영 구성 요약

`.env.example` → `.env.local`. 주요 값: `DATABASE_URL`, `NEXTAUTH_URL`·`NEXTAUTH_SECRET`, `BOOTSTRAP_TOKEN`, `ARCHIVE_ROOT`·`STAGING_ROOT`·`PREVIEW_ROOT`(서로 분리된 UNC 경로), `SOURCE_ROOTS`(읽기 전용 원본 JSON 배열), 선택 `RESTORE_ROOT`, FFmpeg/AV1 설정, `MAINTENANCE_*`.

~~~powershell
docker compose --env-file .env.local up -d postgres
npm run db:deploy
npm run build
npm start          # 웹
npm run worker     # 별도 서비스: 파일 작업·정리 예약
~~~

웹과 worker는 같은 `.env.local`과 NAS 경로를 써야 한다. 실제 자료를 연결하기 전에 [운영 체크리스트](docs/OPERATIONS-CHECKLIST.ko.md)를 끝낸다.

## 10. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `npm ci`에서 prisma generate 실패 | Prisma 엔진 다운로드(binaries.prisma.sh) 접근이 막힌 네트워크. 프록시/방화벽 허용 또는 사내 미러(`PRISMA_ENGINES_MIRROR`) |
| 업로드 첫 청크 415 SIGNATURE_MISMATCH | 확장자와 실제 형식이 다름. 파일을 확인하거나 올바른 확장자로 저장 |
| 다운로드 503 STORAGE_MISMATCH / 409 OBJECT_UNAVAILABLE | NAS 파일이 없거나 크기가 다름. 관리자 무결성 패널과 `npm run maintenance` 결과 확인 |
| ZIP·복원 409 MANIFEST_CORRUPT/MISMATCH | NAS manifest가 손상·변경됨. 백업에서 해당 객체 복구 후 재점검 |
| 작업이 계속 QUEUED | worker 미실행(운영) 또는 dev:local 종료. 긴 AV1 인코딩이 앞에 있는지 작업 관리에서 확인 |
| 삭제가 WAITING_FOR_LEASES | 진행 중인 다운로드·복원. 전송이 끝나거나 lease가 만료되면 자동 재시도 |
| PGlite 오류·잠금 | dev:local과 다른 Prisma 프로세스를 동시에 띄웠는지 확인 |

## 11. 용어

| 용어 | 뜻 |
| --- | --- |
| 결과물 / 소스 | 방송에 쓰인 최종 영상·이미지 / 그것을 만든 재료(FBX, 텍스처, UE 프로젝트 등) |
| 대표 버전 | 카드와 상세 기본값으로 보이는 공개(READY) 버전 |
| 보존 계획(plan) | 업로드·조사 파일마다 포함/제외/검토와 교체/추가/승계/제거를 고정한 목록과 hash |
| 실사용 확인 | 소스 연결 중 실제 사용을 확인하고 근거·확인자를 남긴 것(그 외는 '연관') |
| 전용 / 공유 소스 | 삭제 대상 결과물만 쓰는 소스 / 다른 결과물·과거 버전도 쓰는 소스 |
| tombstone | 삭제 후에도 남기는 최소 기록(대상 ID·시각·감사) |
