# 제작 결과물·제작 소스 아카이브 소프트웨어 설계 문서 SDD

사용자는 Netflix 같은 화면에서 **제작 결과물을 찾아보고 → 필요시 연결된 소스를 확인하고 → 다운로드**한다. 관리자는 영상·이미지·3D·기타 파일·Unreal 프로젝트를 업로드하거나 승인된 NAS에서 가져와 별도 NAS에 보존한다. **PostgreSQL 관계형 테이블 + JSONB 확장 메타데이터 + 별도 NAS 파일 보존**을 목표 구조로 확정한다.

| 항목 | 기준 |
| --- | --- |
| 버전·갱신일 | 6.0 / 2026-10-29 (Asia/Seoul) |
| 확인 환경 | Windows PC + NAS/SMB, 약 10명·10TB |
| 사용자 기본 흐름 | 결과물 탐색 → 상세/연결 소스 → 정확한 버전 다운로드 |
| 등록·수정 | 파일 업로드 확정 시 자동 새 버전. 수정 업로드의 같은 상대경로는 새 버전에서 교체하고 나머지는 승계 |
| 삭제 | 삭제창에서 결과물+연결 아카이브 동시 삭제가 기본 선택. 사용자 확인: 전용 소스만 삭제하고 공유 소스는 보존·연결 해제 |
| UE 보존 | 에디터 출력 영상·이미지와 재편집 프로젝트 원본. DDC·Intermediate·로그 등 재생성 자료만 제외, 미사용 Content 보존, 실행용 빌드 없음 |
| 연계·이력 | [TDD](TDD.v6.0.ko.md), [SDD v5.2](SDD.v5.2.ko.md), [TDD v5.2](TDD.v5.2.ko.md) |
| 구현과의 구분 | 현행 코드는 Prisma/MongoDB·Movie 모델. 이 문서는 PostgreSQL 목표 설계이며 코드·운영 DB·NAS 이행/삭제는 수행하지 않음 |

## 1 목적·우선순위

목적은 **제작 결과물과 재편집 가능한 제작 원본의 아카이브**다. 영상과 이미지는 독립 결과물이며, 3D(FBX 등)·소스 이미지·기타 파일/폴더·UE 프로젝트를 연결한다. 영상 없는 이미지 제작 건도 동일하게 등록·탐색·다운로드한다.

v6.0은 v5.2의 MongoDB 유지 방침을 PostgreSQL+JSONB로 변경하고, 웹 업로드·자동 버전·수정 시 경로별 교체·확인 후 보존 파일 삭제를 필수로 추가한다. 과거 문서의 '보존본 삭제는 전부 범위 밖' 문장은 **사용자가 확인한 삭제를 지원하되 원본 NAS/PC는 수정하지 않음**으로 대체한다. 업로드는 과거 버전을 제자리 수정하지 않는다.

Fab 게시·판매·독립 에셋 패키지·UE 의존성 자동 이행·AI·3D 뷰어는 선택 후속이다. UE 내부 에셋의 보존과 다른 프로젝트에서 즉시 사용 가능한 독립 패키지 제공은 구별한다. 기존 방송연도·방송 제목·예능/교양 분류·담당자·제작부조·키워드·전체 설명/팀 메모 합의는 유지한다.

## 2 대표 업무와 성공 기준

### 2.1 열람자

1. 홈의 방송연도별 영상·이미지 카드와 검색/필터에서 결과물을 찾는다.
2. 상세에서 영상 재생 또는 이미지 확대/갤러리, 설명·키워드·메모·버전을 본다.
3. 필요할 때 연결 소스 영역을 펼쳐 3D·이미지·기타·UE의 해당 버전·용량·환경을 확인한다.
4. 결과물 원본이나 소스 파일/폴더/UE 보존본을 다운로드한다. 원본 제작 NAS가 오프라인이어도 별도 보존 NAS에서 제공한다.

### 2.2 등록·수정 담당자

1. 제작 건과 결과물·소스 역할, 파일/폴더 또는 승인 NAS 가져오기를 선택한다.
2. 웹 업로드는 재개 가능한 세션으로 전송하며 UE/폴더는 포함·제외·검토 계획을 확인한다.
3. 신규 항목은 v1, 기존 항목의 업로드는 다음 버전을 서버가 자동 부여한다. 사용자가 버전 번호를 직접 입력하지 않는다.
4. 수정 화면은 기준 버전의 파일 트리를 보여주고 추가/교체/승계·명시 제거를 미리 표시한다. 동일 경로 파일은 신규 업로드가 우선한다.
5. 모든 필수 파일의 NAS 보존·해시 검증과 DB 확정이 끝난 뒤 새 버전이 대표가 된다. 실패/취소 중에는 이전 대표 버전을 계속 제공한다.
6. 결과물과 변경 소스를 한 번에 저장하면 변경 소스의 새 버전과 그 버전을 가리키는 결과물 새 버전을 같은 배치로 공개한다.

### 2.3 삭제 담당자

삭제창에서 **'결과물과 연결 아카이브 함께 삭제'가 기본 선택**된다. 대안은 '결과물만 삭제'와 '취소'다. 대상 항목의 모든 버전·파일 수/용량·전용 소스·보존되는 공유 소스와 실제 회수 예상 공간을 확인한 후 실행한다. 기본 선택만으로 삭제를 실행하지 않는다. 영상 대신 이미지 결과물에도 같은 규칙을 적용한다.

완료 기준은 정확한 자료·관계·버전·바이트의 확보와 요청한 삭제 범위의 일치다. 보존 해시 검증, 미리보기 준비, UE 에디터 실제 열기 검증은 각각 판정한다.

## 3 기능·비기능 요구사항

AR-01~18의 ID를 유지하고 변경된 판정을 갱신한다. AR-19~24·NFR-07/08을 추가한다.

| ID | 1차 필수 요구·수용 조건 |
| --- | --- |
| AR-01 | 영상·이미지 결과물을 Netflix형 카드·방송연도 행·전체 보기로 제공. 이미지 단독 제작 건 지원 |
| AR-02 | 방송연도·유형·종류·담당·부조·키워드·제목·설명 검색/필터, URL 복원·빈/실패/로딩 구분 |
| AR-03 | 결과물 상세는 미디어·설명·버전·보존 상태 중심, 연결 소스는 필요시 확인하고 다운로드 |
| AR-04 | 3D·소스 이미지·기타 파일/폴더·UE를 제작 건/결과물 버전에 연결. 실제 사용 확인과 단순 연관 구별 |
| AR-05 | 항목·제작 버전·보존본 분리. 공개된 과거 내용/관계 불변, 파일 변경은 새 버전. 확인된 삭제는 8장 절차 |
| AR-06 | 승인 루트/업로드 파일의 dry-run·include/exclude/review·정책 버전·예외·수량/용량 계획 |
| AR-07 | 원본 read-only·일관된 snapshot·전송/복사 변경 감지·멱등 재시도. 원본 삭제/수정0 |
| AR-08 | UE 재생성 파일만 제외, 미사용 Content·필수 plugin binary·외부 자료·Saved 예외 보존 |
| AR-09 | 별도 NAS의 경로·수량·크기·강한 checksum·manifest 검증 후 보존 완료, 부분 복사는 완료 금지 |
| AR-10 | 원본 가용성과 보존 상태 분리. 단절·부분 조사·미발견을 삭제로 오인하지 않음 |
| AR-11 | 영상 proxy·이미지 썸네일/갤러리를 원본과 별도 생성. 미지원 표시와 원본 보존 |
| AR-12 | 결과물/소스의 지정 보존 버전 다운로드, 전체 폴더/UE의 구조·재개·실패/만료 처리 |
| AR-13 | 새 위치 복원·manifest 대조·UE 환경/대표 map 실제 열기 검증. 복사와 재편집 가능 판정 분리 |
| AR-14 | 전체 설명·키워드·팀 메모·작성자·근거 버전·수정 이력. 장면 주석 필수 아님 |
| AR-15 | 결과물·소스·검색 건수·파일·경로·upload/job/download/delete에 서버 팀/프로젝트/행위 권한 |
| AR-16 | metadata revision·baseVersion 경쟁409, 과거 관계 고정, 재조사로 수동값/대표 버전 덮어쓰기 금지 |
| AR-17 | 조사/업로드/보존/파생/다운로드/복원/삭제의 진행·오류·취소/재시도·자원/공간 제한 |
| AR-18 | PostgreSQL·관계/메모/정책·manifest·NAS bytes·삭제 tombstone/작업 백업·복구·무결성 재검사 |
| AR-19 | 관계/권한/검색 키는 PostgreSQL 테이블·FK/UNIQUE/CHECK, 확장 기술정보는 JSONB, 실제 bytes는 별도 NAS |
| AR-20 | 신규/추가 파일 업로드 완료마다 자동 v1/vNext. 중복 완료 요청은 동일 버전, 실패/취소는 공개 새 버전0 |
| AR-21 | 수정 업로드는 기준 버전+신규 파일 overlay. 같은 정규화 상대경로 교체·다른 경로 추가·나머지 승계, 과거 버전 유지 |
| AR-22 | 삭제창의 동시 삭제 기본 선택·결과물만/취소 제공. 범위·전 버전·공유 보존·용량을 명시하고 확인 후 실행 |
| AR-23 | 전용 연결 소스만 함께 삭제, 공유 소스 보존/연결 해제. 참조·전송 lease·경쟁·NAS 실패를 처리하고 실제 제거 전 완료 금지 |
| AR-24 | 기존 MongoDB에서 PostgreSQL로 ID/인증/즐겨찾기/자료를 검증 이행·대조·전환/롤백. 운영 DB 즉시 변경 금지 |

| ID | 기준·측정 조건 |
| --- | --- |
| NFR-01 | 내부망 동시10명 metadata API p95≤1초·첫 카드 p95≤2초 제안. 영상+이미지5,000/파일100,000은 임시 시험값 |
| NFR-02 | 약10TB. 전수 해시/복사는 worker, 화면 요청과 분리. 원본/보존/업로드 임시/파생/회수 가능 용량 실측 |
| NFR-03 | 원본 생성/수정/삭제0·비허용 bytes/경로 노출0·파일 경로 탈출0. 보존 삭제는 확인 범위에 한함 |
| NFR-04 | 장애/경쟁/재시도에도 거짓 보존/삭제 완료0·승인하지 않은 과거 버전 손상0. lease/fencing·자원 제한 |
| NFR-05 | 한글/Unicode 경로·IME·키보드/터치·초점·모션 감소·대용량 업로드/삭제 상태 접근성 |
| NFR-06 | request/job/배치 ID·규칙/manifest hash·검증/삭제 증거. RPO24시간/RTO1영업일은 제안값 |
| NFR-07 | UUID·BIGINT·TIMESTAMPTZ·팀 복합FK·JSONB schemaVersion·제약/인덱스·버전/대표 전환 원자성 검증 |
| NFR-08 | 승계 파일은 불변 객체 참조를 재사용, 덮어쓰기0. 물리 삭제는 보존/준비 중 참조와 활성 lease 모두0인 확인 대상만 |

## 4 결과물 중심 UI·분류

| 화면 | 필수 내용 |
| --- | --- |
| /archive | 영상·이미지 결과물 중심의 방송연도 행·검색·전체/영상/이미지 전환. 소스 탐색은 보조 이동 |
| /archive/results | 방송연도·종류·담당·부조·키워드·유형 필터·전체 보기 |
| /archive/items/[id] | 재생/확대·설명·버전·보존 상태·결과물 다운로드, 펼칠 수 있는 연결 소스 영역·메모 |
| /archive/projects/[id] | 제작 건의 결과물·소스·UE·참여자·이력 |
| /archive/sources, /archive/unreal/[id] | 소스 검색/역참조, UE 환경·보존 범위·검증·전체 다운로드 |
| /archive/new | 결과물/소스 역할·파일/폴더 업로드·NAS 가져오기·진행/재개·보존 계획 |
| /archive/items/[id]/edit | 기준 버전·파일 트리·추가/교체/승계/제거 계획·새 버전 저장. 기존 파일에 직접 쓰지 않음 |
| 삭제 대화상자 / 작업 화면 | 기본 동시 삭제·결과물만·취소, 모든 버전/전용·공유 범위·회수량·확인, 처리/실패/재시도 |

영상 없는 이미지 제작 건도 홈 카드·상세·갤러리를 제공한다. 이미지의 결과/소스 역할과 파생 썸네일을 구분한다. 카드에는 유형·제목·방송연도·대표 이미지·보존 상태를 표시한다. 클릭은 상세 진입이며 자동 음향은 없다. 확장자/파일명만으로 실제 사용 여부를 확정하지 않는다.

기본 홈에는 active 항목의 검증된 공개 대표 버전만 노출한다. 첫 업로드의 draft/실패는 관리 작업 화면에 표시하며, 새 버전을 준비하는 동안 기존 대표 결과물은 계속 제공한다.

방송연도는 정수/null로 관리하고 파일 수정일로 대체하지 않는다. TS 계열·홀·중계차는 사전이며 TS-1~TS-D 개별 코드는 임의 생성하지 않는다. 담당자·부조·키워드는 복수 관계다. 검색은 NFC/공백 정리·리터럴 q(1~100 코드 포인트)·필드 OR/필터 AND·limit24(1~48), 방송연도 DESC NULLS LAST/id DESC다. 300ms 디바운스·IME·이전 응답 차단·URL 복원을 적용한다. 소스 목록은 결과물 목록과 cursor를 분리한다.

## 5 PostgreSQL + JSONB + NAS 데이터 설계

### 5.1 역할 분리와 자료형

PostgreSQL은 트랜잭션·관계·검색·작업/삭제 이력, NAS는 원본 보존 bytes·manifest·파생/임시 파일을 담당한다. DB에 영상/FBX/UE ZIP을 BLOB/base64로 넣지 않는다. PostgreSQL 데이터 디렉터리는 DB용 지원 디스크/볼륨에 두며 NAS 파일 보존 공유와 구분한다.

기본키는 UUID, 파일 크기/누적 바이트·버전 카운터는 BIGINT, 시각은 TIMESTAMPTZ(UTC 저장/Asia-Seoul 표시), 방송연도는 SMALLINT NULL, 해시는 알고리즘+SHA-256 hex다. BIGINT는 API에서 정밀도를 잃지 않도록 10진 문자열로 전송한다. 상태는 명시 열과 CHECK/enum, 큰 목록은 행으로 관리한다.

### 5.2 테이블

| 테이블 | 주요 열·역할 |
| --- | --- |
| users / accounts / sessions / verification_tokens | 기존 NextAuth 사용자/인증을 PostgreSQL 타입과 ID로 이행 |
| teams / memberships / project_access | 팀·역할·제작 건별 view/download/upload/archive/delete/restore 권한 |
| production_projects | id, team_id, title, description, created_by, revision |
| categories / facilities / keywords | 종류·제작부조·키워드 사전, team 범위의 정규화 이름/코드 고유 |
| archive_items | project_id, kind, roles, title, broadcast_title/year, category_id, current_version_id, revision, next_version_no, lifecycle |
| item_responsibles / item_facilities / item_keywords | FK가 있는 복수 담당·부조·키워드 관계 |
| item_versions | item_id, version_no, base_version_id, file_set_id, description, technical_metadata JSONB, created_by, state |
| item_links | from_version_id, to_version_id, associated/usedConfirmed, evidence, confirmer. 과거 버전 연결 고정 |
| memos / item_metadata_revisions | 근거 버전·작성자·메모/revision, 설명/분류 변경의 이전값·수정 이력 |
| storage_roots / source_files | source/archive/preview/staging/restore 승인 루트·접근 참조 / 루트별 원본 상대경로·stat·가용성 |
| file_sets / file_set_entries | 조사/업로드 snapshot·확정 파일 목록의 경로·크기·mtime/hash. 원본 현재값과 분리 |
| archive_policies | 정책 종류/version, rules JSONB, schema_version, 작성자·예외 기준 |
| archive_plans / plan_entries | 고정 file_set/기준 버전/정책·revision·plan hash / 파일별 INCLUDE/EXCLUDE/REVIEW·이유·추가/교체/승계/제거 |
| upload_batches / upload_sessions / upload_parts | 화면 저장 단위·기준 버전/요청자/멱등 키 / 대상 항목·전송 상태·기대 크기/hash / part 번호·offset·크기/hash |
| archive_versions | item_version_id, plan_id, storage_root_id, manifest_object_id/hash, file_count/total_bytes, state, verified_at |
| archive_files | archive_version_id, canonical_relative_path, original_relative_path, storage_object_id, role, size_bytes, checksum |
| storage_objects | team_id, root_id, object_key, size_bytes, checksum, state, verified_at. 불변 물리 파일 1개, 여러 버전에서 참조 가능 |
| unreal_archive_profiles | item_version_id UNIQUE, uproject_path, engine_version/build/distribution, environment JSONB, schema_version |
| preview_derivatives | item_version_id, type, storage_object_id, dimensions, generator/version, state. 원본과 분리 |
| jobs / job_events / file_leases | upload/archive/preview/download/restore/delete 작업·checkpoint/lease/fencing / 진행·오류 / 사용 중 물리 객체의 소유자·만료 |
| restore_validations | archive_version_id, 환경 snapshot JSONB, 검증 범위/대표 map·보고서·상태 |
| delete_requests / delete_entries | 요청자·scope·대상 revision/계획 hash·확인·상태 / 항목·버전·객체별 삭제/공유 보존/실패 결과 |
| audit_events / legacy_id_mappings / favorites | 행위·대상·안전한 변경 요약 JSONB / Mongo ObjectId와 새 UUID의 고유 대응 / 사용자-항목/legacy Movie 즐겨찾기 관계 |

ArchiveItem의 kind는 VIDEO/IMAGE/MODEL3D/FILE/UNREAL_PROJECT, roles는 RESULT/SOURCE/REFERENCE의 제한된 복수 값이다. 결과물과 소스의 공통 파일/버전 구조를 재사용한다. 삭제 tombstone과 최소 감사 이력은 남기며 콘텐츠 bytes와 민감한 본문을 계속 보관하기 위한 수단으로 쓰지 않는다.

### 5.3 관계·제약·인덱스

~~~mermaid
erDiagram
    production_projects ||--o{ archive_items : contains
    archive_items ||--o{ item_versions : versions
    item_versions ||--o{ archive_versions : preserves
    archive_versions ||--o{ archive_files : lists
    storage_objects ||--o{ archive_files : supplies
    item_versions ||--o{ item_links : from
    item_versions ||--o{ item_links : to
    item_versions ||--o| unreal_archive_profiles : describes
    upload_batches ||--o{ upload_sessions : groups
    delete_requests ||--o{ delete_entries : records
~~~

- 업무 행은 team_id·작성/수정시각을 갖는다. 팀 경계는 복합FK와 서버 권한 검증으로 보장한다.
- team_id+id의 복합UNIQUE/FK로 타 팀 참조를 거절한다. 같은 팀에서도 제작 건별 권한을 검사하며, 재사용 권한이 있는 다른 제작 건의 소스를 연결할 수 있다.
- UNIQUE(item_id, version_no), UNIQUE(archive_version_id, canonical_relative_path), UNIQUE(root_id, object_key), UNIQUE(root_id, source canonical path), UNIQUE(upload_session_id, part_no)를 둔다. 업로드/삭제 멱등 키는 (team_id, actor_id, operation, request_key) 범위로 고유하고, 같은 키에 다른 입력은409다. 버전 연결은 (from_version_id, to_version_id) 중복을 방지한다.
- current_version_id/base_version_id는 같은 item의 버전만 가리키는 복합FK로 제한한다. 대표는 공개 ready 버전만 지정하며 draft/delete_pending/deleted는 금지한다. 상태 조건은 서비스와 필요한 DB trigger로 보장한다.
- 보호 대상 FK는 RESTRICT/NO ACTION을 기본으로 하고 DB CASCADE로 NAS 파일을 지우지 않는다. 공개 버전의 파일 bytes/manifest 변경은 불변 규칙으로 거절한다.
- size_bytes≥0, 공개 version_no>0, JSONB object형/schema_version, roles 허용값 등을 CHECK와 API 검증으로 보장한다. FK 대상 ID·권한·상태·검색 키를 JSONB에만 넣지 않는다.
- B-tree는 (team_id, kind, broadcast_year DESC NULLS LAST, id DESC), project_id, version/item, source link 역참조, job state, delete/object state에 둔다. 제목 등의 리터럴 부분 일치는 실측에 따라 pg_trgm/GIN 등을 선택하고 보통 B-tree만으로 고속 검색을 보장하지 않는다.
- JSONB의 engine/plugin/technical 조건은 필요한 키의 expression/GIN index만 추가하고 실제 데이터의 EXPLAIN으로 확인한다.

### 5.4 JSONB와 물리 보존

JSONB는 영상 codec/해상도·이미지 색공간·3D 기술정보·UE engine/toolchain/plugin 선언·규칙·검증 요약처럼 유형별 차이에 사용한다. schema_version, 타입/길이/깊이/크기 상한을 검증한다. 대규모 파일 목록·FK·업무 상태는 별도 행으로 둔다. JSONB가 유지하지 않는 키 순서/공백에 manifest hash를 의존시키지 않고 규정한 canonical serialization으로 생성한 manifest bytes를 NAS에 보존해 hash를 DB에 기록한다.

NAS 물리 배치 예시는 archive-root/objects/team-uuid/object-uuid이며 사용자 입력 경로를 그대로 물리 키로 사용하지 않는다. archive_files가 복원용 원래 상대경로를 가진다. 새 버전의 변경 파일은 새 storage_object, 미변경 파일은 같은 불변 object를 참조한다. 매번 전체 버전 bytes를 복제하지 않는다. 팀 간 hash 자동 중복 통합은 하지 않는다.

source·archive·staging·preview·restore 루트를 구분하고 원본과 archive의 동일/중첩을 금지한다. SMB 인증정보를 DB 평문/JSONB나 다운로드 manifest에 넣지 않고 서비스의 비밀 관리에서 참조한다.

### 5.5 독립 상태

| 대상 | 상태 예시 |
| --- | --- |
| 원본 가용성 | online / offline / missingCandidate |
| upload | created / uploading / paused / received / verifying / committed / failed / cancelled / expired |
| 보존 | catalogued / planned / copying / verifying / verified / partial / failed |
| 파생 | pending / ready / unsupported / failed |
| 복원 검증 | notTested / passed / failed / environmentMissing |
| 콘텐츠 생명주기 | active / delete_pending / deleted |
| 삭제 요청 | planned / confirmed / deleting / waitingForLeases / completed / partial / failed / cancelled |

verified는 계획한 bytes의 보존 확인이며 UE 재편집 성공이 아니다. delete_pending은 비노출/신규 제공 중지이며 물리 삭제 완료가 아니다. 준비 중 버전은 대표로 지정하지 않는다.

## 6 업로드·자동 버전·보존 처리

### 6.1 등록과 재개

브라우저 파일/폴더 선택과 승인 NAS 가져오기 모두 같은 file_set→plan→NAS 검증 경로를 사용한다. 브라우저의 임의 로컬 경로를 서버가 읽을 수 있다고 가정하지 않는다. 폴더/UE는 상대경로를 전송하고 브라우저에서 지원하지 않으면 승인 NAS 가져오기를 안내한다.

대용량 파일은 청크 전송을 제안하며 session/part 번호·offset·기대 크기/hash·기한과 재개 위치를 관리한다. 같은 part/bytes 재전송은 기존 성공 결과, 다른 bytes는409다. 크기/형식 signature/확장자를 검증하되 확장자만으로 형식/안전성을 보장하지 않는다. 서버가 수신 후 전체 SHA-256을 다시 계산한다. 클라이언트가 주장한 hash를 검증 증거로 대체하지 않는다.

UE 폴더는 상대 파일 목록을 먼저 보내 정책 확인 후 include만 전송할 수 있다. 서버도 제외 규칙/예외를 재검사하고 review 미해결은 확정하지 않는다. 수신한 제외 캐시를 영구 NAS에 그대로 옮기지 않는다. 업로드/임시 용량·사용자 권한·part 범위·경로 충돌을 전송 전/중에 검사한다.

### 6.2 자동 버전과 수정 overlay

신규 item은 공개 시 v1, 기존 item은 공개 시 vNext를 서버가 채번한다. draft 번호는 미확정일 수 있고 실패/취소는 공개 버전을 만들지 않는다. 한 번의 화면 저장/파일 묶음은 새 버전 하나이며 청크/파일마다 버전을 만들지 않는다. 신규 업로드가 같은 hash여도 확정한 별도 업로드 작업이면 새 버전을 만들고, 같은 멱등 키의 재전송만 같은 버전을 반환한다.

수정 화면은 baseVersionId+item revision+planHash를 고정한다. 중복 키는 **같은 item 안의 정규화한 상대경로**다. 이름/hash만으로 교체하지 않는다. Windows/복원 대상의 case 정책·NFC를 적용하고 원문 표기를 보존한다. 한 입력 묶음에 같은 정규화 경로가 여러 개면 조용히 last-write-wins하지 않고409/review로 처리한다.

| 기준 버전과 입력 | 새 버전 |
| --- | --- |
| 같은 상대경로에 새 파일 | 새 bytes로 교체 |
| 기준 버전에 없는 상대경로 | 추가 |
| 기준 버전에 있고 이번에 미전송 | 기존 불변 object 승계 |
| 화면에서 명시 제거 지정 | 새 버전에서 제외, 과거 버전 유지 |
| 같은 hash·다른 상대경로 | 별도 항목, 임의 통합/교체 금지 |
| 파일/제거 지정 없이 설명만 변경 | metadata revision 수정, 파일 버전 증가 없음 |

예: v1의 Final.mp4/Textures/Earth.png/Content/Satellite.uasset에 Final.mp4와 Models/Rocket.fbx를 전송하면 v2는 Final.mp4 교체·FBX 추가·나머지2개 승계다. v1은 변하지 않는다. UE 폴더 부분 업로드의 미전송 파일은 삭제로 처리하지 않는다. 필요한 Content가 남는지 overlay 전체를 계획 평가한다.

대표가 바뀐 오래된 base의 확정은409로 재확인하며 자동 rebase하지 않는다. 단독 소스의 새 버전 업로드는 과거 결과물 링크를 자동 변경하지 않는다. 결과물 편집에서 소스를 갱신할 때는 새 결과물 버전이 해당 소스 새 버전을 명시적으로 가리킨다.

### 6.3 복사·검증·원자적 공개

1. 승인 NAS 조사는 원본 read-only·snapshot/안정 구간을 사용하고 읽기 전후와 전체 목록 변화를 감지한다. 변경은 stale/needsReplan이다.
2. file_set·policy·예외·overlay·include/exclude/review와 이유·용량을 고정한다. 필수 review 미해결·원본/보존 동일 루트·경로 이탈·공간 부족은 실행 전 거절한다.
3. staging에서 수신/복사·전체 bytes 검증 후 불변 NAS object로 승격한다. SMB rename/영속화 조건을 실제 환경에서 검증하고 rename만을 완전성 근거로 삼지 않는다.
4. archive_files는 비공개로 준비하고 manifest와 모든 include object 검증을 끝낸다. 승계 object도 가용성/보호 참조를 확인한다.
5. 짧은 PostgreSQL transaction에서 대상 item을 일정 순서로 잠그고 base/revision/권한/lifecycle을 재검사한다. 버전 번호 채번·배치 전체 필수 item ready·대표 포인터/관계·감사/outbox(job)를 함께 확정한다.
6. 긴 NAS 전송을 DB transaction 안에 두지 않는다. NAS와 DB는 하나의 ACID transaction이 아니므로 journal·멱등 키·fencing·대조로 장애를 복구한다. NAS 완료/DB 실패 object는 비공개 보호 대상으로 재개/정리하고 과거 보존본을 훼손하지 않는다.

manifest는 schema/version/plan/source snapshot·정책/예외·include 상대경로/크기/hash·exclude 이유/bytes·review 해결·UE 환경·검증을 담는다. 일반 제공본에서 내부 절대경로/자격증명/비공개 제외 파일명을 뺀다. ZIP 자체 hash는 외부 배포 레코드에 둔다. 원본 NAS partial/offline/미발견은 item/보존 파일의 삭제 근거가 아니다.


## 7 Unreal 프로젝트의 필요한 파일만 보존

### 7.1 적용 원칙

확정 목표는 **제작 결과 동영상·이미지와 나중에 다시 열고 수정하는 프로젝트 원본 보존**이다. 사용자는 별도 실행 프로그램을 만들지 않았으므로 실행용 빌드는 보존 대상이 없고, 그 부재를 누락/오류로 처리하거나 아카이브를 위해 실행 프로그램을 새로 만들지 않는다. 프로젝트 소스를 보존하는 것과 개별 인공위성을 추출하는 것은 다른 업무다. 전체 `Content`를 참조 분석으로 가지치기하거나 현재 열지 않은 map/asset을 제거하지 않는다.

영상·이미지는 다시 렌더할 수 있더라도 제작 결과물이므로 보존한다. 재생성 파일 제외 규칙은 DDC·Intermediate·로그 같은 캐시/중간 자료에 적용하며 최종 출력물을 제외하는 근거가 아니다. 출력 저장 위치가 `Saved` 하위여도 결과물로 등록한 파일은 보존 규칙이 우선한다. Editor 모듈·필수 플러그인 binary와 필요한 `Build` 입력 파일은 별도 배포용 실행 프로그램과 구별해 기존 예외/보존 정책을 유지한다.

정책은 단순한 전역 확장자 차단이나 `**/Binaries/**` 일괄 제외가 아니다. **프로젝트 루트·플러그인 단위 경로와 파일 역할**로 평가한다. 원본/소스/복원 필수로 명시한 예외가 캐시 기본 제외보다 우선한다. 이름이 같다는 이유로 `Content/Saved` 등 실제 콘텐츠 폴더를 시스템 `Saved`처럼 제외하지 않는다. 알 수 없는 파일은 review로 두고 자동 누락시키지 않는다.

### 7.2 포함·제외·검토 정책

| 경로/자료 | 기본 판정 | 이유·예외 |
| --- | --- | --- |
| 프로젝트 `.uproject` | include | 엔진 연결·플러그인·모듈 descriptor 보존 |
| `Config/**` | include | 기능 설정 보존. 개인/비밀 설정은 별도 접근/보존 정책으로 검토하며 자동 마스킹·원본/보존 내용 변형 금지 |
| `Content/**` | include | map·asset·외부 actor/object·필요 동반 파일 포함. 미사용 추정만으로 제거 금지 |
| `Source/**`·`.Build.cs/.Target.cs` | include | 일부 C++ 포함 프로젝트의 재빌드 자료. 소스가 없으면 없다고 기록 |
| `Build/**`, authored Shaders/스크립트·Resources | include/review | 실제 빌드/프로젝트 동작에 필요한 입력일 수 있음. Build를 Intermediate와 동일 취급하지 않음 |
| 프로젝트 `Plugins` | 구성별 판정 | `.uplugin`·Content·Config·Source·Resources·Shaders·Build·필수 ThirdParty 라이브러리 포함, 엔진 플러그인은 정확한 설치/복구 참조 기록 |
| 루트/각 플러그인의 `Intermediate/**`, 실제 DDC 경로 | exclude | 재생성 가능한 중간 산출물·캐시. 프로젝트 밖 공유/Zen 캐시도 복사하지 않음 |
| `Saved/Logs`, `Saved/Crashes`, 검증된 temp/cache | exclude | 편집/복원 입력이 아닌 진단·임시 자료 |
| `Saved/Autosaves/Backup`, `Saved/Config` 등 | review → 필요한 것만 include | 고유 미저장 작업/실제 사용 설정이 있으면 확정 source/config나 별도 복구자료로 보존. `Saved` 전체 무검토 제외 금지 |
| 루트/플러그인 `Binaries/**` | review | 소스·필수 의존성·동일 build/toolchain으로 재생성 가능이 확인된 산출물만 exclude. 바이너리 전용 플러그인/외부 DLL 등 대체 불가 파일은 include |
| `.vs/.idea`, 생성 `.sln/.vcxproj`, VCS 작업 데이터 | exclude/review | 검증된 IDE/생성/이력 캐시는 제외. 직접 작성한 build/task 설정·필수 스크립트는 명시 include |
| 에디터에서 출력한 제작 동영상·이미지 | include | 저장 위치와 무관하게 결과물 원본 보존. Saved 하위 출력도 캐시로 제외하지 않음 |
| 별도 Cooked/Staged/Packaged 실행 프로그램 | 대상 없음 | 사용자 작업에서 생성하지 않음. 부재는 정상이며 빌드 생성/실행 검증을 요구하지 않음. 필수 Editor/plugin binary·Build 입력과 구별 |
| 프로젝트 밖 영상/이미지/오디오·3D 원본·재임포트 자료 | 명시 include/연결 | 승인 루트에서 실제 bytes를 보존하고 연결/복원 방법 기록. 절대 경로 문자열만 저장하고 복원 가능으로 표시 금지 |

`Saved`·`Binaries`의 review는 필수 자료가 실제로 없다는 확인 또는 보존 예외를 남긴 뒤 해소한다. 캐시가 들어 있다는 이유만으로 폴더 전체를 필요 파일로 간주하지 않고 파일/하위 경로별로 선별한다. 소스가 없는 플러그인의 필수 binary를 보존하는 것은 불필요 파일 저장이 아니다. 반대로 같은 DLL 확장자라는 이유로 모든 DLL을 보존하지 않는다.

필터 결과에 포함/제외/미해결 수·바이트, 예외 원인, 정책 버전을 표시한다. 전체 절감률은 `(원본 조사 바이트-포함 바이트)/원본 조사 바이트`로 제안하며 알 수 없는 원본 개수/바이트가 있으면 완전한 절감률로 표시하지 않는다. 보존본에 원본 불필요 캐시가 들어가지 않았는지 manifest로 확인한다.

### 7.3 복원 환경과 사실의 경계

엔진 minor/build·Launcher/커스텀 fingerprint·플러그인 버전/설치/소스 유무·C++ toolchain·대표 map·외부 자료·필수 설정을 기록한다. 엔진 전체를 프로젝트마다 중복 보존하지 않고 관리되는 엔진/플러그인 보존 참조·정확한 공급/복구 경로를 사용한다. 사내 커스텀 엔진의 실제 보관 위치/불변 build 식별이 없으면 environmentMissing/needsReview다. 버전 숫자만 같다고 호환 완료로 표시하지 않는다.

보존 완료는 포함 bytes의 검증이다. ‘프로젝트 열기 검증 통과’는 원본 경로와 캐시 없이 별도 복원본에서 기록된 환경으로 열고 대표 map·asset·Actor Sequence·필요 C++ 빌드를 확인한 증거가 있어야 한다. 소스 없는 C++ binary만으로 재편집 가능을 보장하지 않는다. 환경이 없으면 notTested/environmentMissing으로 표시하며 임의 엔진 업/다운그레이드·플러그인 실행을 수행하지 않는다.

## 8 미리보기·다운로드·복원·삭제

### 8.1 미리보기와 다운로드

영상 proxy/frame·이미지 썸네일/갤러리는 별도 파생물이다. 미지원 PSD/EXR/TIFF 등은 실제 decoder 지원 범위를 표시하며 원본 보존/다운로드는 가능하다. 프리뷰를 원본으로 반환하지 않는다.

단건은 고정 archiveVersion/file, 폴더/UE는 해당 보존본 전체 manifest에서 다운로드한다. NAS 원본을 다시 읽어 ZIP 내용을 바꾸지 않는다. 일반 ZIP에는 상대경로·검증정보·필요 환경만, 관리자 조사/제외 보고서는 별도 권한으로 제공한다. 파일명·폴더 구조·크기/hash를 유지한다.

content는 매 요청 view/download 권한·부모 lifecycle·버전·객체 상태를 검사한다. private/no-store, attachment, 안전한 파일명/Content-Type, Range206/416, 고정 ETag/validator로 재개한다. queued/preparing/ready/failed/expired/cancelled와 임시 ZIP 수명을 표시한다. 다른 사용자의 job content는 거절한다. delete_pending/deleted 항목의 과거 URL·range·미디어·임시 ZIP도 새 제공을 막는다.

### 8.2 복원

새 작업 위치에만 해제하고 기존 제작 폴더/원본을 덮어쓰지 않는다. path traversal·절대경로·case 충돌·junction/symlink·용량 폭증을 해제 전 검사한다. 보존 manifest와 대조한 뒤 UE를 등록된 신뢰 환경에서 명시 검증한다. 원본 캐시 없이 실제 대표 map/Sequence·필요 Editor 모듈 빌드를 확인하며 보존 NAS를 수정하지 않는다.

### 8.3 삭제창·범위

| 선택 | 결과 |
| --- | --- |
| 결과물과 연결 아카이브 함께 삭제 **기본 선택** | 선택 결과물의 전 버전/결과 파일/파생물과 직접 연결된 전용 소스 항목의 전 버전/보존 파일을 삭제 |
| 결과물만 삭제 | 결과물의 전 버전/결과 파일/파생물 삭제, 연결 소스 항목/보존 파일은 유지하고 해당 결과물 연결만 해제 |
| 취소/창 닫기 | DB·파일 변화0 |

'함께'는 같은 물리 순간의 삭제가 아니라 **하나의 확인된 요청으로 묶어 처리**한다는 뜻이다. 결과물만 삭제도 카드 숨김에 그치지 않고 해당 결과물 원본 bytes를 삭제 대상으로 삼는다. 제작 건 전체·관계 없는 소스·원본 PC/NAS·백업 파일은 범위에 자동 포함하지 않는다.

사용자 확정: **공유 소스는 보존하고 현재 결과물과의 연결만 해제**한다. 삭제 집합 밖의 보존된 결과물/소스/과거 버전 링크가 하나라도 같은 소스 항목을 참조하면 공유다. 같은 프로젝트 폴더 소속/파일명/hash라는 이유로 전용으로 보지 않는다. 직접 연결된 소스만 범위 후보이며 소스의 링크를 재귀 순회해 임의 삭제하지 않는다. 독립 관리 중인 소스·보존 hold·다른 제작 건의 권한 부족은 보존/차단 사유로 표시한다. 비허용 관계의 이름은 노출하지 않는다.

선택 결과물 자체가 다른 항목의 공유 소스로 사용되는 다중 역할 항목이면 계획을 sharedReferenceConflict(409)로 차단한다. 공유 소스 항목 분리/참조 재지정 후 범위를 다시 확인하며, 다른 결과물의 링크가 끊어진 채 원본 bytes를 지우지 않는다. 후보 소스를 공유로 보존하면서 다른 후보의 참조 판정도 달라지면 최종 삭제 집합이 안정될 때까지 다시 판정한다.

계획에는 대상 item/version/file·전용/공유·논리 용량·실제 회수 가능 바이트·남는 공유 객체·취소 불가 전환점을 표시한다. 항목의 전체 버전을 지우는 사실을 문구로 명시한다. 개별 과거 버전 삭제 UI는 이번 기본 범위에 넣지 않는다. 기본 선택은 명시 확인을 대신하지 않으며 관리자/삭제 권한이 있어야 실행한다.

### 8.4 삭제 transaction·NAS 처리·경쟁

1. delete plan은 item/link revision·정확한 대상/공유 판정·계획 hash를 고정한다. 확인 전에는 바이트/공개 상태를 바꾸지 않는다. stale이면409로 새 범위를 확인한다.
2. 확인 transaction에서 대상 item을 일관된 순서로 잠그고 권한/관계/참조를 재검사한다. delete_request와 전부의 delete_entry를 기록하고 delete_pending·연결 해제/비활성·job/outbox를 함께 확정한다. 신규 업로드 공개·대표 전환·새 링크·다운로드를 차단한다.
3. 삭제 worker는 유효 fencing과 개별 진행 기록으로 처리한다. 같은 NAS object를 참조하는 **미삭제 보존본·준비 중 업로드/상속 예약·preview·활성 download/restore lease**를 확인한다. 참조 count 캐시만 믿지 않고 실제 관계를 조회한다.
4. 객체에 대한 새 참조/lease 생성과 purge 전환은 같은 storage_object 행 잠금/상태 규칙을 사용한다. 살아 있는 참조가 있으면 bytes는 보존한다. 활성 전송은 종료/만료를 기다리고 새 제공은 차단한다. 만료 worker는 lease를 갱신/재검증하지 않고 읽기를 재개할 수 없다. purge_pending 객체에 새 참조를 만들지 않는다.
5. 미참조·무lease·확인 범위의 object만 승인 archive/preview/temp 루트 아래의 검증된 object_key로 제거한다. 공유폴더 전체를 경로 문자열로 재귀 삭제하지 않는다. source 루트의 파일은 항상 그대로다.
6. NAS 파일 제거/부재 확인 후 행별 purged_at을 기록한다. 공유로 남긴 bytes는 보존 사유, 삭제해야 할 bytes가 남으면 partial/failed/waitingForLeases다. 모든 의도된 항목이 제거되고 남은 공유 참조가 정합할 때만 completed다.
7. NAS 불가/거절/중단은 멱등 재시도한다. 같은 confirm/key는 동일 delete_request이고 오래된 worker는 완료를 쓰지 못한다. 일부 삭제 후 이전 상태로 되돌렸다고 표시하지 않는다.

계획/확인 직전 취소는 변화0이다. 확인 후 첫 물리 삭제 전에는 job 잠금 아래 모든 변경을 되돌릴 수 있을 때만 취소 허용한다. 물리 삭제가 시작되면 취소 불가·진행/재시도로 안내한다. 완료 후 일반 UI의 즉시 복구를 보장하지 않으며 별도 백업 복구 절차가 필요하다. 기본 보존 유예기간이나 자동 기한 파기는 추가하지 않는다.

확인된 삭제는 최소 tombstone/대상 ID/시각/감사·삭제 원장을 남긴다. 백업 복구 시 최신 삭제 원장과 재대조하여 삭제한 콘텐츠를 자동 재공개하지 않는다. 백업의 물리 만료 정책은 별도 운영 정책이며 이 삭제창의 즉시 삭제 대상이 아니다.

## 9 구조·API·기존 코드 이행

~~~mermaid
flowchart LR
    U[팀 브라우저] --> UI[Netflix형 결과물 탐색 상세 소스 다운로드]
    UI --> A[인증 및 권한 Archive API]
    A --> DB[(PostgreSQL 관계형 + JSONB + Job)]
    U --> UP[재개 가능한 업로드]
    UP --> A
    W[업로드 조사 보존 삭제 worker] --> DB
    W --> S[승인 PC 및 제작 NAS 읽기 전용]
    W --> R[별도 보존 NAS 불변 objects 및 manifest]
    P[파생 및 다운로드 worker] --> DB
    P --> R
    P --> T[preview 및 임시 저장소]
    A --> R
    A --> T
    R --> V[새 복원 공간 및 신뢰 UE 검증]
~~~

Next.js/React·NextAuth·SWR/Zustand를 출발점으로 사용하고 Prisma의 **PostgreSQL connector**를 목표로 변경한다. 현재 MongoDB connector를 바꾼 것만으로 기존 데이터가 이행되지는 않는다. DB job/outbox·lease로 시작하며 대용량 전송/삭제는 worker로 분리한다. PostgreSQL 메이저·Prisma/Node 지원 버전은 구축 시 호환 검증 후 고정하며 이번 문서 편집에서 라이브러리를 업그레이드하지 않는다.

### 9.1 API 초안

| API | 계약 |
| --- | --- |
| GET /api/archive/items, /years | 결과물 중심 kind/role/year/q/project/분류/담당/부조·권한 필터·cursor/limit, items/nextCursor |
| GET/POST /api/archive/projects, GET /projects/[id] | 제작 건 등록·결과물/소스 연결 |
| POST /api/archive/items, GET/PATCH /items/[id] | 논리 항목 생성201 / 상세 / metadata revision 조건 수정. 파일 교체는 upload API |
| GET /api/archive/items/[id]/versions | 공개 버전 목록·대표·보존/검증 상태 |
| POST /api/archive/upload-batches | 신규/수정 mode, 대상별 baseVersionId/revision, 멱등 키. 세션/추가·교체 계획 |
| PUT /api/archive/uploads/[id]/parts/[partNo] | 보호된 part/offset/size/hash·재전송/재개, 충돌409 |
| GET /api/archive/uploads/[id], POST .../[id]/complete | 전송 상태 / 수신 완료·서버 검증 시작202. 이것만으로 버전 공개 아님 |
| POST /api/archive/upload-batches/[id]/commit | 확정 planHash/base/revision/멱등 키,202→검증 후 batch 전체 새 버전/대표 원자적 공개 |
| POST /api/archive/uploads/[id]/cancel | 준비 중 취소·staging 정리, 기존 보존본 유지 |
| POST /api/archive/scans, /plans, /jobs | 승인 NAS 조사→정책/overlay 계획→별도 NAS 복사·검증. 입력 plan/revision/hash 고정 |
| GET/PATCH /api/archive/plans/[id] | 포함/제외/review·예외·revision·용량, 확정 목록의 조용한 변경 금지 |
| PUT /api/archive/version-drafts/[id]/links/[targetVersionId] | 새 버전의 소스 관계 설정. 공개 과거 버전 관계는 직접 수정 금지 |
| GET/PATCH /api/archive/versions/[id]/description, POST .../[id]/memos | 전체 설명/메모·작성자·revision 이력 |
| GET /api/archive/versions/[id]/manifest, /unreal/[id], /policies | 안전 manifest / UE 환경·보존/복원 상태 / 버전 정책 |
| GET /api/archive/media/[id] | 부모 권한/lifecycle 검사한 proxy/썸네일·range |
| POST /api/archive/downloads, GET .../[id], GET .../[id]/content | 고정 version/file·요청자 멱등 key,202 / 준비 상태 / 보존 원본·ZIP |
| POST /api/archive/restores, GET .../[id], POST .../[id]/validations | 새 위치 복원·manifest / 실제 등록 UE 환경 검증·증거 |
| POST /api/archive/items/[id]/delete-plans | scope=resultAndExclusiveSources 기본 또는 resultOnly, 범위·공유 보존·용량·revision/hash,201 |
| POST /api/archive/delete-requests | planId/hash/revision·명시 확인·멱등 key,202. 기본 체크만으로 실행 금지 |
| GET /api/archive/delete-requests/[id], POST .../[id]/cancel, POST .../[id]/retry | 행별 진행·공유 보존·partial / 허용 시 취소 / 동일 범위 재시도 |

GET에 부작용을 두지 않는다. cursor는 endpoint·필터·정렬·limit·팀/사용자 접근 범위에 바인딩하고 매 요청 검증한다. q/필터 변경 시 초기화한다. 권한 조건을 집계 전에 적용한다. 쿠키 인증 mutation은 CSRF/Origin 검증을 적용한다.

오류는 error.code/message/requestId. 400입력·401비인증·403행위 권한·404없음/비공개·409revision/base/plan/part/삭제 경쟁·410삭제된 허용 객체/만료·413용량·415미지원 전송·416range·500내부·503NAS불가를 구분한다. 비허용 항목은 삭제 여부를 노출하지 않는다. 원본 offline 중 보존 메타데이터 조회는200+가용성이다.

### 9.2 MongoDB → PostgreSQL 이행 계획

1. 현재 [schema.prisma](../../prisma/schema.prisma)의 MongoDB/ObjectId·User.favoritesIds·Movie와 [favorite API](../../app/api/favorite/route.ts), NextAuth account/session 참조를 조사한다. 현행 코드/운영 DB는 이번 작업에서 변경하지 않는다.
2. 별도 PostgreSQL 스키마·migration을 작성하고 User/Account/Session/VerificationToken·즐겨찾기 관계·아카이브 테이블을 만든다. 물리 파일 마이그레이션은 별도 manifest/검증 작업이다.
3. legacy_id_mappings에 entityType+ObjectId→UUID를 고유 기록하여 재실행 가능하게 import한다. 로그인 hash/provider 연결·즐겨찾기·참조·건수/hash를 대조하고 모호한 자료는 검토한다.
4. 기존 Movie는 명시적 유형의 staging legacy import로 보존한다. 없는 연도/소스는 미상, 외부 URL 자동 fetch 없음. NAS bytes 검증 전 verified로 표시하지 않는다.
5. 테스트 환경에서 로그인/권한·UI·업로드/버전·다운로드·삭제·백업 복구를 검증한 뒤 백업/최종 증분을 확보하고 쓰기 중지 구간에 전환한다. 이행 실패 시 원 DB와 앱으로 복귀한다.
6. PostgreSQL에 새 쓰기가 생긴 이후 롤백은 단순 URL 교체가 아니다. 신규 UUID/파일/삭제 원장을 대조·보존·재이행하는 별도 계획을 사용한다. MongoDB를 즉시 삭제하거나 구 API 배열 계약을 무단 변경하지 않는다.

## 10 권한·운영·백업

조회자는 허용 결과물·소스·미리보기, downloadOriginal은 원본 다운로드를 허용한다. 편집/upload·archive 실행·delete·restore·정책/루트 관리를 별도 권한으로 둔다. 삭제창은 권한이 있는 사용자에게만 실행 가능하며 연결 전용 소스에도 삭제 권한을 재검사한다. 권한이 부족한 대상은 숨겨서 삭제하지 않고 확인 범위의 변경/차단을 안내한다.

NAS 서비스 계정 ACL을 사용자에게 승계하지 않는다. upload 파일·UE plugin을 일반 worker에서 실행하지 않는다. 앱 서버/worker만 NAS에 접근하며 웹에서 SMB 절대경로나 자격 증명을 다운로드 링크로 제공하지 않는다. 계정 전환 시 SWR/모달/업로드·다운로드 상태를 초기화한다.

PostgreSQL 백업과 NAS 객체/manifest·관계·정책·환경·삭제 원장을 함께 복구 시험한다. 파생물은 원본과 생성기 정보가 있으면 재생성할 수 있다. DB와 NAS의 복구 시점 차이를 reconciliation으로 대조하고 삭제 원장 이후 콘텐츠의 재공개를 차단한다. source와 archive 장애는 별개다. 확인 없는 보존본 기한 파기·hash 기반 자동 중복 삭제는 도입하지 않는다. 만료 staging/임시 ZIP 정리는 영구 보존본과 별도 정책이다.

## 11 단계·완료 기준

| 단계 | 산출물 | 완료 기준 |
| --- | --- | --- |
| A 스키마·표본·정책 | PostgreSQL/JSONB/NAS 모델·실제 결과/소스·UE 예외·삭제 범위 | 파일/권한/전용·공유/환경·migration fixture 확정 |
| B 결과물 중심 UI | 카드·상세·연결 소스·검색·메모·다운로드 진입 | 영상/이미지/이미지 단독·접근성·권한 통과 |
| C 등록·보존·자동 버전 | 재개 업로드·NAS 가져오기·overlay·manifest·자동 vNext·원자 공개 | 교체/승계/실패/경쟁·과거 불변·checksum·다운로드 통과 |
| D 삭제·복원·이행·운영 | 기본 동시 삭제·공유 보존·NAS 삭제 재시도·UE·PostgreSQL 이행/복구 | 실제 SMB/DB의 정상/장애·물리 삭제·참조/lease·백업 복구·성능 증거 |
| E 후속 선택 | 개별 UE 에셋 자동 분리/이행·Fab 게시·AI/3D 뷰어 | 별도 채택 시 과거 설계와 다시 검토 |

릴리스는 B~D의 필수 B0/B1 테스트를 통과해야 한다. 필수 자료 손실·원본 변경·권한 누출·거짓 버전 공개/보존/삭제 완료·공유 소스 손실이 있으면 차단한다. 설계 문서 점검과 실제 DB/SMB/UE 시험을 구분한다.

## 12 결정과 남은 구현 확인

| 구분 | 반영 |
| --- | --- |
| 사용자 확정 | PostgreSQL + JSONB + 별도 NAS 보존 |
| 사용자 확정 | 결과물 탐색 → 필요시 연결 소스 확인 → 다운로드 |
| 사용자 확정 | 업로드 시 자동 새 버전, 수정에서 중복 파일은 새 업로드로 교체 |
| 설계 구체화 | 중복은 같은 item의 정규화 상대경로, 교체는 새 버전에서만 적용. 미전송 파일 승계·과거 버전 유지 |
| 사용자 확정 | 삭제 시 동시 삭제 여부 문의, 결과물+연결 아카이브 삭제가 기본 |
| 사용자 추가 답변 확정 | 전용 소스만 함께 삭제, 공유 소스는 보존하고 현재 결과물 연결만 해제 |
| 기존 유지 | 영상·이미지 동등 결과물, 제작 메타데이터, 약10명/10TB·Windows/SMB·UE군·전체 메모 |
| UE 확정 | 재생성 캐시만 제외·미사용 Content 보존·에디터 결과물/원본 보존·실행용 빌드 없음 |
| 이전 방침 변경 | MongoDB 유지는 PostgreSQL로, 보존본 삭제 전면 범위 밖은 확인된 삭제 작업 지원으로 대체 |
| 선택 후속 | Fab/독립 패키지·자동 의존성 이행·AI·3D 뷰어는 현재 릴리스 게이트 아님 |

실제 NAS/폴더 표본·파일 수·필수 plugin/외부/Saved 예외·TS 개별 코드·계정별 upload/delete 권한·가용 공간/백업 책임·PostgreSQL/worker 구축 사양을 구현 전에 확인한다. chunk 크기/세션 만료/자원 동시성·RPO/RTO/성능 값은 시험 후 확정한다. 이 값의 미확정이 현재 문서 업데이트를 막지는 않는다.

## 13 근거·현재 검증 상태

PostgreSQL의 [JSONB와 인덱싱](https://www.postgresql.org/docs/current/datatype-json.html), [관계 제약](https://www.postgresql.org/docs/current/ddl-constraints.html), [행 잠금](https://www.postgresql.org/docs/current/explicit-locking.html)을 기술 근거로 확인했다. JSONB 용도·NAS object/버전/삭제 작업 설계는 본 프로젝트의 설계 판단이다. 지원 버전/운영 환경의 실제 성능·정합성은 테스트로 검증한다.

UE의 [디렉터리 구조](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-directory-structure), [플러그인](https://dev.epicgames.com/documentation/en-us/unreal-engine/plugins-in-unreal-engine), [DDC](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-derived-data-cache-in-unreal-engine)를 보존 정책 근거로 사용한다. Epic이 모든 프로젝트의 동일 제외표를 보증한 것은 아니므로 예외를 검토한다.

v6.0은 요구·데이터/파일 관계·업로드/교체/삭제 계약·TDD 추적·링크를 정적 점검한 설계다. 코드/Prisma schema·의존성·운영 DB/NAS bytes를 바꾸거나 업로드/삭제·DB/SMB/브라우저/UE 기능 시험·배포를 실행하지 않았다. v5.2 문서는 이력으로 보존했다.

정적 점검 결과: 요구사항32개(AR24/NFR8)와 테스트79개 모두 추적표에 연결, E2E8개, 현행/신규 이력 문서4개의 로컬 링크19개 정상, 코드 블록/ID 중복/인코딩 오류 없음. UE 보존 정책 7장은 v5.2와 동일하다. 이는 기능 테스트 통과 수가 아니다.
