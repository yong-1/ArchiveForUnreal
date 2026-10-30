# 구현 및 검증 기록 — 2026-10-29

[SDD v6.2](SDD.ko.md)와 [TDD v6.2](TDD.ko.md)에 대한 실행 가능한 로컬 구현입니다. 설계의 모든 운영 수용 시험이 완료된 상태는 아닙니다.

## 구현된 동작

| 영역 | 구현 |
| --- | --- |
| UI | 방송연도별 결과물 카드, 유형/제작 건/담당/부조 필터, 리터럴 검색·페이지·즐겨찾기, 상세·버전·연결 소스·메모, 등록/수정·계획·작업·팀 설정 |
| 미디어 | 원본은 NAS 보존 객체, 화면 영상은 실제 AV1 WebM/Opus, 이미지/영상 포스터는 WebP. Sharp/FFmpeg/FFprobe. 변환 실패·미지원은 원본 보존과 분리 |
| 신규 구축 | Prisma PostgreSQL 모델·JSONB·UUID·BIGINT·복합 FK·CHECK·불변성 trigger, 초기 관리자/팀/루트 설정. 데이터 마이그레이션 없음 |
| 파일/버전 | 브라우저 스트리밍 SHA-256·8MiB 청크·재개, 정규화 경로 overlay·승계, 다중 항목 원자적 대표 전환·멱등 확정, 읽기 전용 NAS 조사/복사 |
| UE | descriptor에 따른 중첩 플러그인 scope·캐시 제외·Content 보존·Saved/Binaries 검토, 환경·플러그인 기록. 재편집 가능 검증 기본 NOT_TESTED |
| 다운로드/복원 | 버전 고정 원본·HTTP Range/ETag·ZIP64/manifest, 별도 위치 복원·해시 대조·기존 파일 덮어쓰기 방지 |
| 삭제 | 기본 동시 삭제 계획·확인·공유 보호·전 버전 대상·lease 대기·물리 부재 확인·실패/재시도·시작 전 취소 |
| 권한/작업 | NextAuth 계정·팀/제작 건/행위 권한, same-origin 변경 API, 허용 루트·경로 검증, 작업 lease/fencing·감사 기록 |

## 실제 스키마와 설계 대응

테이블 이름은 snake_case, 열 이름은 Prisma 모델의 camelCase를 사용합니다. 정확한 DDL은 [migrations](../prisma/migrations), 모델은 [schema.prisma](../prisma/schema.prisma)가 기준입니다.

- source_files/file_sets/file_set_entries의 논리 snapshot은 archive_plans.summary와 plan_entries(sourceMtime/size/path/판정)로 통합했습니다. 아직 상시 원본 전체 카탈로그 테이블을 운영하지 않습니다.
- 보존 규칙은 policy.ts와 plan의 policyVersion으로 관리하며, 정책 편집 테이블/UI는 없습니다. 확정 계획·파일별 검토 결정을 보존합니다.
- job_events는 별도 테이블 없이 jobs의 상태/오류/결과·attempt/fence와 audit_events를 사용합니다. 세부 바이트 진행률 이력은 아직 없습니다.
- 프로젝트 권한은 view + canEdit/canDelete/canDownload이고 restore/검증 보고는 관리자 전용입니다. 새 관리자에게 팀 전체 권한이 부여됩니다.
- RESTORE_ROOT는 서버 환경 설정입니다. storage_roots에는 원본/보존/임시/미리보기 루트를 등록합니다.
- UE 실제 에디터 열기는 자동화하지 않습니다. 관리자 API POST /api/archive/versions/{versionId}/validations는 OPERATOR_REPORT 근거를 기록합니다. PASSED는 엔진과 보고서 SHA-256이 필요하며 자동 검증 증거가 아닙니다.

## 실행 결과

Windows / Node 24.18.0 / Next 16.4.3 / Prisma 6.19.3 / 개발 PostgreSQL 호환 PGlite. 통합 파일은 격리된 로컬 디스크이며 SMB 공유가 아닙니다.

| 실행 | 결과·범위 |
| --- | --- |
| npm run lint | 오류 0·경고 0 |
| npm run typecheck | 통과 |
| npm test | 단위 4개: Windows 경로/NFC, UE policy, Range, canonical JSONB/64비트 |
| npm run test:integration | 통합 15개: 초기 구축, overlay/불변 원본, 청크 재전송, WebP/PNG 대조, AV1/MP4 대조, 공유 삭제, 권한/FK/trigger, 읽기 전용 가져오기·원본 변경, ZIP/Range, 삭제 취소/lease, 배치 확정/낡은 base, lease 상실, 안전한 복원 재개 |
| tests/http/smoke.ts | 격리 QA 서버에서 인증/CSRF·4개 자료 업로드·다운로드 bytes 대조·검색/페이지/cursor/Range·공유 삭제 계획 통과 |
| npm run build | 배포용 컴파일·타입·라우트 생성 통과 |
| 브라우저 수동 확인 | 격리 QA 계정 로그인 → 연도별 카드 → 영상 상세·AV1 플레이어·원본 다운로드 버튼 확인. 연결 FBX 펼치기·기본 동시 삭제/공유 보존 계획·취소까지 수동 확인. 전체 8개 E2E 자동 시험 완료와 다름 |
| 의존성 감사 | 작성 시 npm audit 알려진 취약점 0. 이후 새 공지는 별도 점검 |

테스트 ID는 관련 설계 사례의 **일부 조건**을 검증합니다. 예를 들어 삭제 단절/전원 장애와 동시 lease 상실의 모든 조합을 15개 시험이 포괄하지 않습니다. TDD 78개 설계 사례·E2E 8개 전체 통과로 해석하지 않습니다.

## 실제 자료 연결 전 남은 검증

1. 실제 PostgreSQL 서버·Windows 서비스 계정·UNC SMB에서 재시작/복사/읽기/삭제 권한과 원본 read-only 검증. 웹과 별도 worker 동시성·DB/NAS 단절·공간 부족·프로세스 강제 종료 및 복구.
2. 실제 10TB 파일 수와 대형 파일로 처리량·업로드 재개·메모리·동시 10명/AV1 인코딩 대기시간·NAS 여유 공간 검증. 현재 모든 작업은 worker당 하나씩 실행되어 긴 변환이 뒤 작업을 지연시킬 수 있습니다.
3. 실제 UE/커스텀 엔진·C++·Actor Sequence·외부 재임포트 소스·Saved/바이너리 전용 플러그인 표본으로 보존 계획·새 위치 열기 검증. 엔진 폴더·외부 참조를 자동 수집하지 않으므로 별도 자료로 등록/연결해야 합니다.
4. PostgreSQL + NAS 객체/manifest + 삭제 원장의 같은 시점 백업·복구·삭제본 재공개 방지 연습.
5. 확정/취소된 업로드 청크는 정리합니다. 만료된 미완료 청크·만료 ZIP·실패 DRAFT/미참조 object의 자동 회수는 아직 구현하지 않았습니다. 용량 감시와 수동 조사 절차가 필요합니다. 현재 영구 보존 객체를 자동 GC하지 않습니다. DB 참조/lease를 확인하지 않은 파일 삭제는 금지합니다.
6. 현재 업로드 취소는 확정 전만 지원합니다. 전송 일시정지와 보존 확정 취소는 다릅니다. 작업 재시도는 같은 입력을 사용하고, 낡은 기준은 새 등록 계획이 필요합니다.
7. 카탈로그 조회는 DB 조건 검색이며 대규모 한국어 형태소 검색 엔진은 없습니다. 파일 상세는 첫 1,000개, 메모는 최근 200개, 계획 화면은 일부 목록만 표시하며 ZIP에는 전체 파일이 포함됩니다.
8. 팀원 비밀번호 재설정/SSO·세부 운영 감사 대시보드·백업 스케줄·미디어 고급 색관리/방송 HDR 품질 보증은 후속 운영 작업입니다. 실제 배포와 사용자 NAS 연결은 수행하지 않았습니다.

## 2026-10-30 v6.1 대조 보완

v6.1 SDD/TDD와 구현을 대조해 나온 누락을 다음 순서로 보완했다.

| 단계 | 반영 내용 | 관련 요구·시험 |
| --- | --- | --- |
| 1 버그·안전장치 | 업로드 첫 청크의 확장자별 매직 바이트 검사(415). 상태·종류·JSONB·해시 열 CHECK 추가(migration `20261030000000_state_guards`). 미리보기는 IMAGE/VIDEO 결과물만 전체, 소스는 얕은 경로 대표 이미지 6개까지. 연도별 집계를 검증된 보존본 기준으로 맞춤. 필터 UUID 검증(400)·검색어 공백 정리. 첫 버전이 없는 항목을 작업 관리에 표시하고 이어서 업로드·등록 취소. 사용하지 않는 영화 화면 컴포넌트·훅 삭제 | NFR-03/07, AR-02/11, UPL-03, DB-02/03 |
| 2 관계·이력 | 소스 연결의 실사용 확인(USED_CONFIRMED)·근거·확인자·시각. 같은 근거면 새 버전에서도 최초 확인자 유지. 소스→결과물 역탐색(`GET items/{id}/used-by`). 버전별 설명과 수정 이력(`GET/PATCH versions/{id}/description`), 메모 수정·이력(`PATCH memos/{id}`, `GET memos/{id}/revisions`), 정보 수정 이력(`GET items/{id}/revisions`). migration `20261030000001_history_links` | AR-04/14/16, SRC-01, VER-02/03 |
| 3 화면·운영 | `/archive/projects/[id]`(결과물·소스·UE·참여자·이력), `/archive/unreal/[id]`(환경·포함/제외/검토 통계·절감률·검증 기록·관리자 제외 보고서). `GET versions/{id}/manifest`, `GET unreal/{versionId}`, `GET policies`, `POST uploads/{id}/cancel`, `GET jobs/{id}/events`, `GET admin/integrity`, `POST admin/maintenance`. 정리·무결성 작업(MAINTENANCE): 만료 업로드·청크, 만료·취소 묶음의 draft 버전(ABANDONED)과 그 객체, 만료 ZIP, 48시간 넘은 STAGING 객체 회수, 저장소 ONLINE/OFFLINE 점검, 객체 존재·크기·해시 점검(MISSING/CORRUPT, 오프라인 루트는 판정 제외). ZIP·복원 전 NAS manifest 해시·목록 대조, 복원 전 여유 공간 검사, 스트리밍 전 파일 크기 확인. 작업 진행률과 job_events. migration `20261030000002_operations` | AR-09/10/12/13/17/18, NFR-04/06/08, SAVE-05, OPS-03 |
| 4 E2E·운영 시험 | Playwright 시나리오 5개(E2E-H/A/B, E2E-F, E2E-E, E2E-G, 제작 건·무결성 화면). 실제 SMB·UE·백업·성능은 [운영 체크리스트](OPERATIONS-CHECKLIST.ko.md) | TDD 10장 |

실행 결과(2026-10-30, Linux / Node 22 / PGlite, Prisma 엔진 다운로드가 막힌 환경이라 WASM 쿼리 컴파일러로 대체 실행): lint·typecheck·build 통과, 단위 5개, 통합 28개(기존 15 + B0 6 + 운영 7), E2E 5개 통과. **Windows/Node 24와 실제 PostgreSQL에서 다시 실행해야 한다.** 새 migration 3개는 직접 작성한 SQL이므로 빈 DB에서 `prisma migrate diff`로 schema.prisma와 차이가 없는지 확인한다.

새로 자동 시험으로 다루는 TDD 사례: DEL-03, DEL-06, DEL-07, UPL-03(signature), UPL-07, VER-02/03, SRC-01, SAVE-05, OPS-03(일부), REST-01(공간), DB-06(manifest 변조). 여전히 자동 시험이 없는 사례는 CAT-01~05의 일부 접근성 조건, PLAN-01/02, SCAN-01, SAVE-03/06, UEF-08~11(실제 UE), DOWN-01 전 유형, REST-02/03, SEC-03, OPS-01/02, DB-05, DEL-05/09/12이다.

남은 보완(이번 범위 밖): restore·archive 실행·정책 관리를 제작 건별 권한으로 분리(현재 관리자 전용), worker 작업 종류별 동시성, 원본 NAS 상시 카탈로그(source_files)와 가용성 이력, 정책 편집 화면.

## 개발 QA 재현

전용 LOCAL_DATA_ROOT 경로의 마지막 폴더 이름을 qa-로 시작하게 지정하고 npm run dev:local로 실행한 뒤, 같은 경로를 QA_DATA_ROOT로 지정하여 node --import tsx tests/http/smoke.ts를 실행합니다. 이 스크립트는 가상 계정/팀/자료만 만들며 QA 팀명과 모든 저장소 경로를 검사합니다. 운영 환경에서는 실행하지 않습니다.

운영 실행/환경 변수는 [README](../README.md)를 참고하세요.
