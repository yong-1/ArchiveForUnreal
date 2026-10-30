# 운영 환경 수용 시험 체크리스트

실제 PostgreSQL 서버, Windows 서비스 계정, UNC SMB 공유, 등록된 UE 엔진에서만 판정할 수 있는 항목이다. 자동 시험(단위·통합·E2E)이 통과해도 이 표의 항목은 **미실행 = 미통과**로 본다. TDD v6.1의 B0/B1 판정 원칙을 따른다.

결과는 표 아래 '실행 기록'에 날짜, 수행자, 환경(OS·Node·PostgreSQL major·NAS 모델·공유 경로·UE build), 증거 파일 위치와 함께 남긴다.

## 0. 시작 전

- [ ] 전용 시험 DB와 전용 SMB 공유(source/archive/staging/preview/restore)를 운영 원본과 분리해 준비했다.
- [ ] 원본 fixture의 파일 목록·크기·mtime·SHA-256을 시험 전에 기록했다(원본 변경 0 판정용).
- [ ] `.env.local`의 모든 루트가 UNC 경로이며 서로 겹치지 않는다. 서비스 계정 권한: source=읽기, 나머지=읽기/쓰기.
- [ ] `npm run db:deploy`로 마이그레이션을 적용했고, `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <빈 DB>` 결과에 차이가 없다.

## 1. PostgreSQL 신규 구축 (INIT-01~03, E2E-H)

- [ ] 빈 DB → 마이그레이션 → `/auth`에서 첫 관리자·팀 생성. 같은 키로 다시 시도하면 409.
- [ ] 웹과 worker 재시작 후 계정·권한·자료 유지.
- [ ] 저장소 루트 하나를 잘못된 경로로 두면 업로드 전에 오류가 나고 원본은 변하지 않는다.

## 2. SMB 실제 동작 (SAVE-01~05, UPL-04/05/07, OPS-03)

- [ ] 2GB 초과 파일 업로드 중 브라우저 종료 → 다시 열어 이어서 업로드 → 해시 일치.
- [ ] worker 프로세스를 복사 중 강제 종료 → 재시작 후 같은 작업이 이어지고 공개 버전은 하나만 생긴다.
- [ ] NAS 공유를 복사 중 분리 → 작업 FAILED, 기존 대표 버전 다운로드 정상 → 재연결 후 재시도 성공.
- [ ] 보존 NAS 공간을 부족하게 만든 뒤 업로드 → 전송 전 409(INSUFFICIENT_SPACE), staging만 정리.
- [ ] 원본 NAS 가져오기 중 원본 파일 수정 → SOURCE_CHANGED, 보존 버전 미공개.
- [ ] `npm run maintenance`(또는 관리자 설정의 '지금 점검') 실행 시 archive 공유를 분리하면 루트 OFFLINE, 객체는 MISSING으로 바뀌지 않는다.
- [ ] 보존 객체 하나를 수동으로 이동 → 점검 후 MISSING, 다운로드 차단 → 원위치 후 다음 점검에서 AVAILABLE 복구.

## 3. 삭제의 물리 처리 (DEL-02/07/08/09/12, E2E-G)

- [ ] 기본 동시 삭제 후 archive/preview/staging에 해당 object 파일이 실제로 없다(탐색기·`dir` 확인).
- [ ] SMB에서 파일을 다른 프로세스가 잠근 상태로 삭제 → PARTIAL, 잠금 해제 후 재시도 → COMPLETED.
- [ ] 대용량 다운로드 진행 중 같은 결과물 삭제 → 전송 종료까지 WAITING_FOR_LEASES, 이후 삭제.
- [ ] 원본(source) 공유의 파일은 삭제 전후 해시·mtime이 같다.

## 4. Unreal 실제 검증 (UEF-09~12, REST-02, E2E-C)

- [ ] 실제 프로젝트 표본(C++ 포함, binary-only plugin, Saved 아래 렌더 출력, 프로젝트 밖 텍스처)을 NAS 가져오기로 조사 → REVIEW 항목을 판단 → 보존.
- [ ] `/archive/unreal/<항목>`의 포함·제외 수량/바이트와 절감률이 실제 폴더와 일치한다.
- [ ] 원본 프로젝트와 DDC에 접근할 수 없는 PC에서 복원본을 열어 대표 map·Actor Sequence·Editor 모듈 빌드를 확인 → 보고서 SHA-256과 함께 `POST /api/archive/versions/<id>/validations`(PASSED/FAILED)로 기록.
- [ ] 환경이 없으면 ENVIRONMENT_MISSING으로 기록한다. 버전 숫자만 같다고 PASSED로 기록하지 않는다.

## 5. 백업·복구 (OPS-02, DEL-12, E2E-D)

- [ ] PostgreSQL(pg_dump 또는 PITR)과 NAS archive/preview 공유를 같은 시점 기준으로 백업.
- [ ] 별도 서버에 복구 → `npm run maintenance`로 루트·객체 대조 → MISSING/CORRUPT 0.
- [ ] 백업 이후 삭제한 결과물이 복구본에서 다시 보이지 않도록 삭제 원장(delete_requests/delete_entries)을 대조하는 절차를 문서화하고 연습했다.
- [ ] RPO 24시간·RTO 1영업일(제안값) 달성 여부를 실측했다.

## 6. 성능·동시성 (OPS-01, NFR-01/02, DB-05)

- [ ] 결과물+이미지 5,000건·파일 100,000개 fixture에서 10명 동시 탐색 시 metadata API p95 ≤ 1초, 첫 카드 p95 ≤ 2초.
- [ ] 긴 AV1 인코딩 중에도 삭제·다운로드 작업 대기 시간이 허용 범위인지 확인(현재 worker 동시성 1).
- [ ] 무결성 점검 해시 예산(`MAINTENANCE_HASH_BYTES`, 기본 2GiB/회)과 주기(`MAINTENANCE_INTERVAL_MINUTES`, 기본 60분)가 NAS 부하에 적절하다.

## 실행 기록

| 날짜 | 수행자 | 환경 | 항목 | 결과 | 증거 위치 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
