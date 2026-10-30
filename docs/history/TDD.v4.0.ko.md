# 팀 전용 Fab · 방송 제작 자산 라이브러리 테스트 설계 문서 TDD

TDD는 **Test Design Document**다. NextFlix 기반 팀 전용 Fab에서 영상 전체 서베잉·단건 원본 서비스를 유지하고, 인공위성 등 선택 재사용 단위를 독립 패키지로 보존·게시·다운로드·다른 프로젝트에서 재현하는 흐름을 검증한다. **원본 방송 프로젝트 접근 없이 보존 패키지만으로 외형·재질·선언한 동작을 재현**해야 한다.

| 항목 | 기준 |
| --- | --- |
| 버전·작성일 | 4.0 / 2026-10-17 (Asia/Seoul), 팀 전용 Fab·독립 재사용 패키지 반영 |
| 대상 설계 | [SDD](SDD.v4.0.ko.md) ARC-01~26·ANF-01~06, 특히 7.3절·12장 |
| 기준 코드 | NextFlix `5b67a0227640b95d8fd115b71c55f84a5cadbdf3` |
| 보존한 회귀 | [TDD v3.0](TDD.v3.0.ko.md), [SDD v3.0](SDD.v3.0.ko.md), [TDD v2.1](TDD.v2.1.ko.md), [SDD v2.1](SDD.v2.1.ko.md) |
| 현재 결과 | 설계·정적 문서 점검. 모든 실행 사례는 목표·미실행 |
| 자동화 기반 | package.json에 test runner/스크립트 없음. 실행 환경 구축 전 |

## 1 재검토 범위와 판정 원칙

확정된 서베잉은 **영상 전체 설명·키워드·메모**이며 장면 구간/AI 요약 성공을 필수로 두지 않는다. 일반 자산 제공은 **웹 원본 다운로드**이고 일반 PC 폴더 복사는 미채택이다. UE 5.3/5.4/5.6/5.8, 실제 Launcher/커스텀 build·Blueprint 중심/일부 C++·Actor Sequence, 기존 제작 프로젝트 이행은 유지한다. Windows·NAS/SMB·약 10명·10TB·방송연도·TS 계열/홀/중계차를 기준으로 한다.

v4.0은 **재사용 패키지 라이브러리·검증된 불변 ZIP·엔진 variant·원본 프로젝트 독립 재사용**을 추가 확정 범위로 둔다. 일반 파일의 임의 대량 ZIP과 구분한다. 원본 파일·원본 프로젝트·빌드 작업공간을 차단한 상태에서 최종 다운로드 artifact로 시험한다. 필수 엔진/플러그인 전제조건은 fixture에 명시하고 이를 숨은 원본 의존성과 구분한다. 테스트에서 깨끗한 프로젝트를 만드는 것은 검증 fixture이며 사용자용 새 프로젝트 생성 기능을 추가한 것이 아니다.

중요도 B0는 권한 노출·원본 훼손·잘못된 대상/버전 서비스, B1은 핵심 업무, B2는 보조 품질이다. 테스트 수준은 U(단위), I(실제 API/DB/파일·SMB/worker 통합), E(브라우저 E2E), UE(실제 엔진)다. SDD 단계 P0~P4와 중요도를 구분한다. metadata/worker mock만으로 실제 미디어·다운로드·SMB·UE를 통과시키지 않는다.

‘전송했다’와 ‘사용자가 저장했다/실제 제작에 사용했다’를 구분한다. 준비 ready·HTTP 성공·UE 프로세스 종료만으로 업무 성공을 판정하지 않는다. 확인된 영상 사용 관계·원본 버전/바이트·제약/권한·사람의 서베잉 기록·실제 UE 검증 결과를 확인한다. 실행하지 못한 항목은 미실행/환경 차단으로 기록한다.

## 2 환경·원본 보존·도구

전용 MongoDB·전용 SMB 공유·격리 관리/임시 저장소·지원 엔진/build별 fixture를 사용한다. 실제 10TB NAS·방송 원본·운영 제작 프로젝트에 실패를 주입하지 않는다. fixture 전후 해시·크기·mtime·파일 생성/삭제 감시로 원본 불변을 확인한다. 운영 10TB 전수 해시로 대신하지 않는다.

단위/컴포넌트는 Next.js 연동 Jest·React Testing Library/MSW, E2E는 Playwright, 통합은 실제 Next API/DB/SMB/worker, UE는 등록 엔진 어댑터를 제안한다. 아직 설치·스크립트 추가하지 않았다. 실제 lockfile·Node·OS·브라우저·DB 구성·NAS/네트워크·서비스 계정·engineInstallationId/build·custom/plugin fingerprint·toolchain/adapter·snapshot을 증거로 남긴다. 세션 mock과 실제 쿠키 인증 검증을 분리한다.

권한 fixture는 조회·편집·관리·다른 팀·제한 프로젝트·downloadOriginal 없음/있음·사용 제약 unknown/restricted/confirmed를 포함한다. 정상 다운로드 fixture는 제약 정책이 허용하는 상태를 명시한다. unknown 처리와 restricted의 허용 조건은 운영 정책으로 확정하며 미확인을 확인 완료로 표시하지 않는다. 가짜 정책의 허용/차단 분기와 실제 팀 정책의 업무 수용 판정을 구분한다.

## 3 기존 회귀용 fixture

| fixture | 구성과 목적 |
| --- | --- |
| A-V1/V2/V3 | 방송연도 2023·2024·null 영상, 다른 제목·구별 가능한 재생 영상. 제작완료/납품/파일 수정일과 방송연도를 다르게 배치 |
| A-VERSION | 한 영상의 작업/납품 버전, 대표 버전 지정, 타 영상 버전 ID 오류 |
| A-META | 서로 다른 방송 제목·예능/교양·담당자·TS 계열/홀/중계차·UE 버전·키워드, 미상·비활성 부조. TS 개별 테스트 코드는 합성 fixture임을 표시하고 실제 사전으로 seed하지 않음 |
| A-REL | 프로젝트 둘에 공유 에셋, candidate/confirmed/rejected, 허용/비허용 프로젝트 교차 관계 |
| A-ROLE | 조회자·편집자·관리자, 다른 팀 사용자, 프로젝트 제한 사용자, 조회만 가능한 source와 쓰기 target |
| A-SOURCE | 전용 SMB/로컬 루트, 한글·공백·유니코드·긴 경로·case 정책, junction·제외 폴더·접근 거절 |
| A-SCAN | 조사 중 쓰는 파일·수정·재실행·삭제/복귀·단절·lease 만료, 부분 실패와 전체 성공 |
| A-MEDIA | 지원 영상·미지원/손상 코덱·짧은 영상·이미지, 프리뷰 실패·범위 요청 |
| A-UE | UE 5.3/5.4/5.6/5.8의 실제 설치별 원본/기존 대상, 기존 map·Blueprint·설정·C++ 모듈·플러그인·비관련 파일 보존 대조, mesh→material→texture·공유/순환/soft/management·외부 미디어 |
| A-UE-EXT | plugin content·C++ 모듈·커스텀 엔진 식별자·redirector·map/외부 actor 패키지, 동명 이종 내용 충돌 |
| A-UE-SEQUENCE | Actor Sequence 포함 Actor Blueprint·컴포넌트·참조 대상·키·바인딩, 대상 플러그인 활성/비활성·모듈 누락, 재생으로 확인 가능한 값 변화 |
| A-SCALE | 영상 5,000·파일 100,000 임시 metadata와 계층형 디렉터리. 크기/성능 시험을 실제 10TB 처리 완료로 보고하지 않음 |

요구 엔진군 5.3/5.4/5.6/5.8은 확인됐으며 실제 설치/build별 fixture와 지원 검증표를 준비한다. Launcher/커스텀을 같은 버전 숫자만으로 같은 실행 환경으로 취급하지 않는다. 원본/대상 snapshot ID·engineInstallationId·build·custom fingerprint·plugin fingerprint·C++ toolchain·adapter·OS·NAS/네트워크·서비스 계정 권한을 증거에 남긴다. 엔진군은 요구 범위이고 실제 통과 결과는 아직 없다.

## 4 유지·보완하는 기존 행위 테스트

### 4.1 탐색·메타데이터·관계

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| ARC-YEAR-01 | B1 I/E | 2023·2024·미상, 수정일이 다른 영상 조회 → 방송연도 내림차순·미상 별도, 빈 연도 없음. 파일 수정일로 재분류하지 않음 |
| ARC-YEAR-02 | B1 I/E | 연도 필터+페이지 끝까지 조회 → 해당 연도만, 정적 fixture 누락/중복 0. 연도/필터/사용자 다른 cursor는 400 |
| ARC-YEAR-03 | B1 I/E | 제작완료 2023·납품 2023·방송 2024 영상, 방송연도 미상·방송일/연도 불일치·새 버전·재조사 → 2024에만 분류, 미상 대체 없음, 불일치 검토·수동 확정 보존 |
| ARC-DETAIL-01 | B1 I/E | 카드·직접 URL·새로고침·뒤로가기 → 같은 영상·프로젝트·버전·갤러리, 목록 위치 복원 |
| ARC-VERSION-01 | B1 I/E | 대표 버전 변경·타 영상 버전 주입·revision 경쟁 → 같은 영상 버전만, 잘못된 관계 거절, 오래된 수정 409 |
| ARC-META-01 | B1 I/E | 방송 제목·종류·담당자·제작부조·UE 버전·키워드 입력/조회 → 원문 보존·검색/필터에 반영, 누락은 미상 |
| ARC-FACILITY-01 | B1 I/E | TS 계열·홀·중계차 선택/검색·복수 연결·명칭 변경/비활성화 → ID와 과거 관계 보존, 없는 ID 거절, 미연결 미상. `TS-1~TS-D`를 단일 선택값/임의 개별 코드로 생성하지 않음 |
| ARC-SEARCH-01 | B1 U/I/E | 한글 IME·특수문자·공백·NFC/NFD·늦은 응답·URL 복원 → 확정 검색 1회, 리터럴·필터 교집합·현재 결과 유지 |
| ARC-REL-01 | B1 I/E | 후보 에셋 확인·거절·반복 반영·역탐색 → 후보를 실제 사용으로 오표시하지 않고 관계 쌍 중복 0 |
| ARC-REUSE-01 | B1 E | 에셋의 미상 UE 버전·의존성/사용 제약 상태 조회 → 미확인 표시, 단독 복사·호환 가능 허위 표시 없음 |
| ARC-A11Y-01 | B1 E | 터치/키보드 카드·모달·갤러리·경로 복사·reduced motion → 모든 핵심 동작 접근·초점 복귀, 자동 음향 없음 |

### 4.2 조사·경로·원본 보존

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| ARC-SCAN-01 | B1 I | dry-run→검토 반영→동일 조사/반영 재실행 → 후보 근거·카운트 일치, 파일/영상/관계 중복 0 |
| ARC-SCAN-02 | B1 I | 쓰기 중 파일·읽기 전후 stat 변경 → 안정될 때까지 보류, 깨진 기술정보/프리뷰로 ready 처리하지 않음 |
| ARC-SCAN-03 | B1 I | 접근 거절·SMB 단절·취소 → partial/failed/cancelled 구분, 완료 허위 표시 없음, 메타데이터 조회 유지 |
| ARC-SCAN-04 | B1 I | 부분 실패와 완료 두 번의 미발견·원본 복귀·제외 규칙 변경 → 완료 조사만 누락 카운트, 자동 삭제 0, 복귀 복원 |
| ARC-SCAN-05 | B0 I | 같은 루트 동시 작업·lease 만료 후 늦은 완료 → 활성 1개, fencing으로 오래된 반영 차단, checkpoint 재개 멱등 |
| ARC-PATH-01 | B0 U/I | traversal·절대/다른 UNC 경로·인코딩·junction·루트 중첩/순환 → canonical 범위 밖 읽기/쓰기 0 |
| ARC-PATH-02 | B1 I/E | 서버와 PC 매핑 다름·PC 권한 없음·도우미 없음 → 정확한 공용 복사값·접근 안내, worker online을 PC 접근 가능으로 오표시하지 않음 |
| ARC-ORIGINAL-01 | B0 I/UE | 조사·프리뷰·UE 성공/실패/취소 전후 fixture 비교 → 원본 생성/수정/삭제 0, 파생물/workspace만 변경 |
| ARC-MANUAL-01 | B1 I | 수동 연도·설명·이미지 선택 후 상충 조사 → 확정값 보존, 충돌은 후보, 확인자·출처·이력 기록 |
| ARC-DUP-01 | B1 I | 같은 크기/mtime 다른 파일·같은 hash 복수 위치·이름 변경 → 자동 병합/삭제 없음, 검토 후보와 위치 별도 유지 |

### 4.3 권한·미디어·백업

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| ARC-SEC-01 | B0 I/E | 비인증/타 팀/비허용 프로젝트로 목록·건수·관계·검색·위치·미디어 직접 요청 → 401/404, 제목·경로·썸네일 포함 노출 0 |
| ARC-SEC-02 | B0 I | 조회자 편집·편집자 루트 등록·위조 teamId·외부 source 참조 → 403/404, DB·파일 변화 0 |
| ARC-SEC-03 | B0 I/E | 원본은 읽히는 worker + 앱 제한 사용자, 계정 전환 중 늦은 응답 → 서비스 계정 권한 승계 없음, 이전 계정 캐시/미디어 노출 없음 |
| ARC-MEDIA-01 | B1 I/E | 서로 다른 두 영상 재생·seek·잘못된 byte range·지원 안 됨/손상/짧은 영상 → 해당 영상 실제 재생·206/416·정확한 오류/중복 프레임 제거 |
| ARC-MEDIA-02 | B0 I/E | 이미지/프리뷰 직접 URL·공유 캐시·권한 회수 후 range 요청 → 보호 접근·no-store·후속 요청 차단. 이미 전달된 바이트 회수는 검증 범위 밖 |
| ARC-MEDIA-03 | B0 I | 이미지 형식/상한·위장 파일·디코더 timeout/메모리 초과 → 허용 정책 검사, 작업 실패 격리, API/원본 보존 |
| ARC-IMPORT-01 | B1 I | 기존 Movie dry-run/import 두 번·재시도·새 화면 비활성화 → legacy 매핑 고유, 연도/위치 미상, 외부 URL 자동 fetch 없음, 기존 Movie/Favorite 보존 |
| ARC-RESTORE-01 | B1 I | 전용 DB·관계·수동값·source 설정·미디어 manifest 백업 복원 → 건수/ID/대표 버전/관계 대조, 비밀 복구 정책·RPO/RTO 측정 |
| ARC-PERF-01 | B1 I/E | 임시 규모·동시 10명, 조사/UE 병행 → metadata p95≤1초·첫 카드 p95≤2초 제안값 측정, 부하/하드웨어/콜드 구분. 미디어 생성 시간 별도 |
| ARC-LOG-01 | B0 I | 실패·재시도·권한 오류 로그 검사 → requestId/jobId 연계, 비밀번호·토큰·물리 루트 비노출 |

### 4.4 Unreal 의존성 분석·이행 자동화

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| UE-ANALYZE-01 | B1 I/UE | 지원 엔진의 mesh→material→texture 분석 → registry 준비 후 전이 closure·클래스·패키지/파일 경로 일치 |
| UE-ANALYZE-02 | B1 U/UE | 공유·순환·soft/management 참조·플러그인/엔진/Script·외부 미디어 → 중복·무한 순회 0, 범주와 미해결 상태, ‘모든 의존성 완료’ 허위 선언 없음 |
| UE-ANALYZE-03 | B1 I/UE | 엔진 미설치·커스텀 식별자·C++ 빌드/플러그인 누락·필수 의존성 미해결 → blocked와 구체적 원인, 파일 목록만으로 verified 처리하지 않음 |
| UE-PLAN-01 | B1 I/UE | 선택 패키지·대상·여유 공간·동명 충돌 계획 → 정확한 목록·크기·hash·검증 범위, 쓰기 전 ready/blocked 판단 |
| UE-PLAN-02 | B0 I/UE | 계획 후 원본/대상/권한 변경·만료·위조 hash → 실행 전 409/needsReplan/403, 대상 변경 0 |
| UE-COPY-01 | B1 I/UE | 등록한 기존 제작 프로젝트를 선택해 계획 실행 → 의존성 포함, 같은 package 경로 보존, 원본/기존 대상 자료 불변, 실제 대상 로드·참조 확인 |
| UE-COPY-02 | B0 I/UE | 같은 경로 같은 hash/다른 내용, source=target/중첩 → 동일 내용 no-op, 다르면 conflict, 기존 파일 덮어쓰기 0 |
| UE-COPY-03 | B1 I/UE | 미지원 엔진 조합·필수 플러그인 불일치·C++ 모듈 누락 → 자동 버전 변환/무조건 플러그인 복사 없이 blocked |
| UE-VALIDATE-01 | B1 I/UE | 프로세스 0 종료이나 참조 누락/Blueprint 오류/map 로드 실패 → succeeded 금지, validationReport·실패 원인. 파일 수/해시만으로 통과 금지 |
| UE-VALIDATE-02 | B1 UE | map·외부 actor·redirector·plugin content fixture → 지원표 범위의 실제 대상 로드 확인. 미지원이면 차단/검토 상태로 표시 |
| UE-RECOVER-01 | B0 I/UE | staging/이행/검증/commit 각 단계에 단절·공간 부족·취소 주입 → journal/checkpoint·안전 중단/복구, 원본/기존 대상 보호 |
| UE-RECOVER-02 | B0 I/UE | 같은 키 재실행·lease 만료 worker·대상 잠금 경쟁·복구 중 타인 변경 → 중복 작업/늦은 commit 차단, 타인 변경 보존·rollbackConflict 보고 |
| UE-EXEC-01 | B0 I/UE | 임의 실행 경로/Python 문자열·승인되지 않은 프로젝트·startup script·루트 탈출 → 입력 거절/격리 정책 적용, 승인 engine/adapter만 실행 |
| UE-BUDGET-01 | B1 I/UE | 작업공간 부족·stale 캐시·큰 프로젝트·NAS 부하 → 쓰기 전 blocked, snapshot/engine/adapter 키 검증, 동시 UE 1개·자원 제한, 전체 10TB 복제 없음 |
| UE-ENGINE-01 | B1 I/UE | 5.3/5.4/5.6/5.8의 실제 Launcher/커스텀 build별 분석·같은 build 이행, 같은 버전 숫자/다른 build·버전 간 미검증 조합 → 설치별 결과, qualified 쌍만 ready, 나머지 blocked. 한 엔진 통과를 전체 통과로 계산하지 않음 |
| UE-SEQUENCE-01 | B1 UE | Actor Sequence Actor Blueprint 이행 → 대상에서 컴포넌트·키·바인딩·참조 유지, Blueprint 컴파일·실제 재생 값 변화 확인. 플러그인/모듈 누락은 설정을 바꾸지 않고 blocked |
| UE-TARGET-01 | B0 I/UE | 기존 대상의 map·Blueprint·설정·C++·plugin·비관련 파일 전후 대조, 없는 target ID/새 프로젝트 생성 옵션 주입 → 기존 자료와 설정 보존, targetRevision 필수, 미지원 생성 옵션 거절 |

폴더 열기 도우미를 채택할 경우 `ARC-OPEN-01 / B0 I/E`를 추가 활성화한다. 실제 Windows에서 만료·재사용·다른 사용자/장치 토큰·임의 경로/명령은 거절하고 허용된 폴더만 연다. 미채택이면 범위 제외이며 경로 복사 테스트를 대체하지 않는다.


## 5 영상 서베잉·사용 증거·원본 서비스 추가 테스트

### 5.1 추가 fixture

| fixture | 구성·판정 근거 |
| --- | --- |
| S-WHOLE | 영상 버전 V1의 전체 설명·키워드·참고할 점·두 작성자의 메모, 메모 없는 영상, 대표 버전 V2. 구간 시간 입력 없이 작성 가능 |
| S-USAGE | 동일 폴더의 미사용 FBX, 프로젝트 내 존재만 확인한 에셋, V1에 사용 확인한 FBX revision R1, 후보/거절 관계, 이후 R2 |
| S-ORIGINAL | 구별 가능한 FBX 원본·이미지 원본·그와 다른 thumbnail/preview, 원문 파일명·알려진 바이트/크기/SHA-256 |
| S-DEPENDENCY | FBX와 별도 텍스처 파일·필수/선택/미해결 의존성, 원본 FBX가 없는 UE 자산 |
| S-ARCHIVE | indexed만 있는 revision, managed 보존본, 보존 중 원본 변경·checksum 불일치·단절·관리 파일 훼손 |
| S-DOWNLOAD | 준비 중/ready/failed/stale/expired 작업·동일/다른 요청자·같은 key·range/중단·용량 부족·느린 원본 |
| S-POLICY | 열람 가능/다운로드 불가, 정책 허용·unknown·restricted, 요청 후 권한 회수·다른 프로젝트/팀 접근 |
| S-RESTORE | survey/memo 작성자·revision·사용 근거·R1/R2·보존 manifest/바이트·재사용 이력 백업 |

### 5.2 서베잉·사용 관계

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| ARC-SURVEY-01 | B1 I/E | 영상 전체 overview·keywords·referencePoints·memo 작성/열람/검색·새로고침 → 구간 시각 없이 가능, 작성자·근거 영상 버전·수정시각 보존. AI/장면 주석을 요구하지 않음 |
| ARC-SURVEY-02 | B1 I/E | 없는 survey GET→expectedRevision=0 최초 저장 동시 요청·기존 편집 충돌·잘못된 작성자 위조 → survey:null/정상 생성·충돌409, 마지막 쓰기로 타인 내용 소실 없음 |
| ARC-SURVEY-03 | B1 I/E | 대표 V1→V2 변경·원본 재조사 후 이전 기록 확인 → V1 기록 유지·이전 버전 참고 표시, V2 기록으로 재귀속/자동 덮어쓰기 없음 |
| ARC-SURVEY-04 | B0 I/E | 스크립트·HTML·악성 링크 문구 메모, 조회자의 직접 수정·다른 프로젝트 메모 ID 요청 → 텍스트 안전 표시·401/403/404, 비허용 메모 노출/변경 없음 |
| ARC-SEARCH-02 | B0 I/E | 메모에만 있는 키워드와 숨긴 프로젝트의 같은 키워드 검색 → 허용 영상·근거 메모 요약/작성자만, 비허용 결과·건수·snippet 노출 없음 |
| ARC-USAGE-01 | B1 I/E | 같은 폴더 FBX·프로젝트 registry 참조·수동 확인 근거 각각 조회/반영 → 발견/프로젝트 관계는 후보, 담당자가 확인한 V1/R1만 실제 사용 표시, 후보/거절과 역참조 구분 |
| ARC-USAGE-02 | B0 I/E | V1→R1 사용 확인 후 R2 등록·대표 변경·원본 위치 변경 → 과거 관계와 다운로드는 R1 고정, R2로 자동 대체 없음 |
| ARC-ASSET-01 | B1 I/E | FBX·이미지 상세의 원본/미리보기·의존성·출처·사용 영상 확인 → 파일 유형/버전 정확, 누락 FBX·미해결 텍스처 표시. 단건 원본을 ZIP/썸네일로 대체하거나 파일 세트 완전 제공으로 오표시하지 않음 |

### 5.3 보존·다운로드·재사용 결과

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| ARC-ARCHIVE-01 | B1 I | indexed→선택 보존→managed, 같은 요청 재실행 → 보존 전/후 상태 구분·바이트/크기/checksum 일치·manifest·원본 변화0·중복 보존 요청 멱등 |
| ARC-ARCHIVE-02 | B0 I | 보존 중 원본 변경·쓰기 중 파일·R2 발견 → 실패/재조사 후보, 기존 R1/관계/보존본 불변, 반쪽/다른 버전 managed 금지 |
| ARC-ARCHIVE-03 | B0 I | 복사 checksum 불일치·보존 객체 손상·manifest 누락 → integrityFailed/failed·이용 차단·원인/복구 작업, managed/ready 허위 표시 없음 |
| ARC-ARCHIVE-04 | B1 I/E | NAS 단절 상태에서 managed와 indexed 상세/다운로드 → 메타데이터·설명/메모 유지, managed 원본 보호 서비스 가능, indexed는 불가 사유·재시도 상태 |
| ARC-DOWNLOAD-01 | B0 I/E | FBX R1·이미지 R1 각각 웹 다운로드·실제 브라우저 저장 파일 검사 → 예상 원본 바이트/해시/크기·파일명·attachment 일치, 파생물/다른 revision 아님 |
| ARC-DOWNLOAD-02 | B0 I | 요청 후/준비 중 indexed 원본 변경·원본 단절 → stale/failed/needsRefresh, 다른 버전 반환0, 준비 snapshot 완료 전 content 제공 거절 |
| ARC-DOWNLOAD-03 | B0 I/E | 열람권한만 있는 사용자·다른 사용자 job ID·다른 팀 revision·정책 차단·ready 후 권한 회수 → 생성/content 각각 재검사, 원본·파일명·작업 상태 비허용 노출0 |
| ARC-DOWNLOAD-04 | B1 I/E | 전송 중단→같은 불변 객체 range 재개·불가능 range·만료 후 재요청 → 206/416/410·같은 validator/버전, 손상 파일 성공 처리 없음 |
| ARC-DOWNLOAD-05 | B0 I | 임시 공간 부족·준비 worker timeout·SMB 읽기 실패·정리 경쟁 → failed/expired·잘린 파일 ready 금지·원본/영구 보존본 유지, 임시파일 정책에 따라만 정리 |
| ARC-DOWNLOAD-06 | B0 I | 같은 key 동시 준비·lease 만료 worker 늦은 완료·다른 사용자 같은 key → 사용자 범위 멱등·중복/stale ready 차단·사용자 간 파일/상태 혼합 없음 |
| ARC-DOWNLOAD-07 | B0 I/E | 한글/공백/긴 파일명·헤더 제어문자·traversal·위장 형식·임의 URL/경로 주입 → 안전한 실제 다운로드명·allowlist 형식 검사·루트 이탈/헤더 삽입/임의 fetch0 |
| ARC-REUSE-02 | B1 I/E | 다운로드 발급·전송 중단/완료·후속 프로젝트 사용 결과 수동 기록 → 발급/전송과 실제 사용 구분, 사용 기록만 확정 결과, 근거 revision·사용자·대상 유지 |
| ARC-RESTORE-02 | B1 I | S-RESTORE 복원 후 survey/memo·사용 근거·R1/R2·managed 파일 대조 → 작성자/내용/ID/관계/체크섬 일치, 원본 위치 정보만 복구하고 보존 파일까지 복구했다고 주장하지 않음 |

### 5.4 팀 전용 Fab fixture

| fixture | 구성·차단/검증 방법 |
| --- | --- |
| P-SATELLITE | 방송 프로젝트 A에 로켓·인공위성·지구·발사대, 인공위성 root `BP_Satellite`·mesh/material/texture·Actor Sequence. 무관한 세 오브젝트는 의존성 없음 |
| P-ASSEMBLY | 인공위성의 여러 Actor·상대 위치·속성, modelOnly/actorAssembly/animatedAssembly 목표. 작업 복제본의 재사용 단위 정리 |
| P-COUPLED | 인공위성이 지구 Actor·전체 방송 시퀀스·프로젝트 설정을 직접 참조하는 버전, 외부 미디어/모듈·필수 plugin 누락 |
| P-RELEASE | 패키지 v1/v2, engine/profile별 variant, manifest·최종 ZIP·checksum·README·고정 포함/제외·출처·보고서 |
| P-ISOLATED | 원본 방송 프로젝트·NAS·빌드 workspace 접근을 거절하고 파일 접근을 감사하는 깨끗한 호환 UE 프로젝트 B. 허용 엔진/플러그인만 별도 설치 |
| P-TARGET | 기존 map·Blueprint·설정·C++·동명 다른 파일이 있는 대상, targetRevision·작업 잠금·복구 journal |
| P-ATTACK | 위조 manifest/hash·다른 variant ZIP·traversal/절대 경로·symlink·case 충돌·압축 해제 용량 초과·임의 script·비공개/제약 파일 |
| P-RESTORE | 패키지 ACL·게시 상태·manifest·파일·ZIP·검증 보고서·재사용 이력 백업, 원본 프로젝트 오프라인 |

### 5.5 재사용 패키지·원본 독립 재현 테스트

| ID | 중요도/수준 | 절차와 목표 기대 |
| --- | --- | --- |
| PKG-UNIT-01 | B1 I/UE | P-SATELLITE에서 인공위성 root/목표 선택 → 필요한 mesh/material/texture/Blueprint/Sequence만 포함·이유 표시, 무관한 로켓/지구/발사대 제외. 폴더 전체 압축 아님 |
| PKG-UNIT-02 | B0 I/UE | P-COUPLED 의존성 수집 → 지구/전체 시퀀스 참조와 이유·범위 표시, 필수 참조를 조용히 빼지 않음. 분리/포함 결정과 독립 검증 전 published 금지 |
| PKG-BUILD-01 | B1 U/I/UE | 공유/순환·hard/soft/management·외부 파일·동반 파일·모듈/플러그인 수집 → 종료·중복0, included/prerequisite/unresolved 구분·필수 unresolved 차단·고정 sourceRevision |
| PKG-BUILD-02 | B1 UE | 여러 Actor 인공위성을 작업 복제본에서 재사용 단위로 정리 → 상대 위치/속성/컴포넌트 유지·원본 변화0·재사용 목표 명시. 파일 수집기의 임의 의미 분류/자동 정리 성공 주장 없음 |
| PKG-MANIFEST-01 | B0 I | 최종 ZIP 해제·payload/README/manifest·서버 레코드 대조 → file 경로/크기/hash·roots·요구 환경·버전·출처·보고서 일치, 원본 절대 경로/비밀0·hash 자기 참조 없음 |
| PKG-VERSION-01 | B0 I/E | 게시 v1 후 원본 변경·v2 추가·같은 label/내용 수정 시도 → v1 bytes/관계/이력 불변·덮어쓰기 거절/409, 사용자가 고른 버전 유지 |
| PKG-VARIANT-01 | B1 I/UE | 5.3/5.4/5.6/5.8·실제 Launcher/커스텀 build별 성공/실패 variant → 통과 profile만 호환 표시/배포, 5.4 통과를 다른 build로 확장하지 않음 |
| PKG-STATE-01 | B0 I | draft/building/failed/blocked에서 ready/published 주입·결과 hash 변경·미검증 게시 → 서버 거절, 검증된 ready variant 최소1·내용 권한/보고서 대조 후에만 게시. 재게시 요청 멱등 |
| PKG-ACL-01 | B0 I/E | 서로 다른 프로젝트/제약의 파일을 패키지에 포함·범위 넓혀 게시·private 출처 조회 → 전체 포함물의 배포 정책 검사, 비허용 bytes/출처 제목·메모·경로 노출0 |
| PKG-DOWNLOAD-01 | B0 I/E | 게시 후 원본 프로젝트·NAS·빌드 workspace 차단→패키지 다운로드·브라우저 저장 ZIP 검사 → 서버 artifactHash/버전/variant 일치·원본 읽기0, 임시 정리 후에도 보존 artifact 유지 |
| PKG-DOWNLOAD-02 | B0 I | DownloadJob에 assetRevision/packageVariant 둘 다/둘 다 없음·다른 사용자 key·다른 variant/hash 주입 → 입력 거절·사용자 범위 멱등, 원본 단건과 ZIP 응답 혼동0 |
| PKG-IMPORT-01 | B1 I/UE | 최종 다운로드 ZIP만 P-ISOLATED의 프로젝트 B에 추가 → 엔진 로드/mesh/material/texture/Blueprint 정상, 원본/빌드 경로 접근0·원본 분석 재실행0. workspace 직접 로드 성공으로 대체 금지 |
| PKG-IMPORT-02 | B1 UE | animatedAssembly의 Actor Sequence 실행 → 키/바인딩/컴포넌트·태양전지판 등 기대 변화·기준 외형 일치. modelOnly에는 애니메이션 지원 표시하지 않음 |
| PKG-SECURITY-01 | B0 I/UE | P-ATTACK ZIP 해제/추가 시도 → 루트 이탈·symlink·case/경로 충돌·용량/파일 수 초과 차단, 임의 script 실행0·대상 쓰기 전 실패 |
| PKG-INTEGRITY-01 | B0 I | 파일 누락/변경·manifest 변조·다른 variant ZIP·보고서 불일치·보존본 손상 → 다운로드/추가 차단·integrity 실패, 원본에서 다른 내용 재생성해 v1 성공 처리 금지 |
| PKG-TARGET-01 | B0 I/UE | packageVariant 입력으로 기존 대상 계획/추가·같은 경로 같은 hash/다른 내용·대상 동시 변경 → 기존 이행 정책/no-op/conflict/409·기존 자료 보존, 원본 조회 권한 대신 패키지 이용+대상 쓰기 검사 |
| PKG-RECOVER-01 | B0 I/UE | build/검증/압축/게시/대상 반영 중 공간 부족·단절·취소·lease 만료·중복 작업 → 부분 artifact 게시 금지·staging 격리·journal 복구·타인 변경 보존·원본 변화0 |
| PKG-WITHDRAW-01 | B0 I/E | 게시 회수/권한 변경 후 상세·새 다운로드·기존 job content/range·기존 이행 계획 실행 → 서버 정책 재검사·배포/실행 차단·이력/보존 bytes 유지. 이미 전달된 bytes 회수는 요구하지 않음 |
| PKG-RESTORE-01 | B1 I/UE | 원본 차단 상태에서 P-RESTORE 복원→ZIP 다운로드·독립 B 재현 → ACL/상태/manifest/report/bytes/hash/이력 일치, DB만 복원하고 패키지 복구 완료로 주장하지 않음 |
| PKG-PERF-01 | B1 I/E | 패키지 빌드/다운로드/UE 작업과 동시10명 탐색 → ANF-01 목표 측정·자원/space 제한·metadata 영향 기록. 전체10TB 복제/전체 프로젝트 패키지화 없이 선택 범위만 처리 |
| PKG-CATALOG-01 | B1 I/E | 영상의 사용 자산→게시 패키지·라이브러리 직접 검색/호환 필터/뒤로가기 → 동일 package/version/variant, package별 카드1개·비허용 draft/variant/출처 노출0 |

## 6 요구사항 추적표

| SDD 요구 | 주요 검증 |
| --- | --- |
| ARC-01 | ARC-YEAR-01~03, ARC-DETAIL-01 |
| ARC-02 | ARC-DETAIL-01, ARC-META-01, ARC-SURVEY-01 |
| ARC-03 | ARC-MEDIA-01~03, ARC-A11Y-01, ARC-ASSET-01 |
| ARC-04 | ARC-VERSION-01, ARC-USAGE-02, ARC-SURVEY-03 |
| ARC-05 | ARC-SCAN-01~05, ARC-PATH-01 |
| ARC-06 | ARC-REL-01, ARC-USAGE-01/02, ARC-ASSET-01 |
| ARC-07 | ARC-SEARCH-01/02, ARC-META-01, ARC-SURVEY-01 |
| ARC-08 | ARC-PATH-02, ARC-A11Y-01, 선택 ARC-OPEN-01 |
| ARC-09 | ARC-REUSE-01, ARC-ASSET-01, ARC-DOWNLOAD-03 |
| ARC-10 | ARC-SEC-01~03, ARC-SURVEY-04, ARC-SEARCH-02, ARC-DOWNLOAD-03/06/07, UE-PLAN-02, UE-EXEC-01 |
| ARC-11 | ARC-SCAN-01~05, ARC-ORIGINAL-01, ARC-DUP-01, ARC-ARCHIVE-02 |
| ARC-12 | ARC-MANUAL-01, ARC-IMPORT-01, ARC-RESTORE-01/02, ARC-SURVEY-02/03 |
| ARC-13 | UE-ANALYZE-01~03, UE-ENGINE-01, UE-SEQUENCE-01, UE-EXEC-01, UE-BUDGET-01 |
| ARC-14 | UE-PLAN-01/02, UE-COPY-01~03, UE-VALIDATE-01/02, UE-RECOVER-01/02, UE-ENGINE-01, UE-SEQUENCE-01, UE-TARGET-01 |
| ARC-15 | ARC-META-01, ARC-FACILITY-01, ARC-YEAR-03 |
| ARC-16 | ARC-SURVEY-01~04, ARC-SEARCH-02 |
| ARC-17 | ARC-USAGE-01/02, ARC-REL-01 |
| ARC-18 | ARC-ASSET-01, ARC-DOWNLOAD-01~07 |
| ARC-19 | ARC-ARCHIVE-01~04, ARC-RESTORE-02, ARC-ORIGINAL-01 |
| ARC-20 | ARC-REUSE-02, ARC-DOWNLOAD-01, UE-COPY-01 |
| ARC-21 | PKG-CATALOG-01, PKG-VARIANT-01, PKG-ACL-01 |
| ARC-22 | PKG-UNIT-01/02, PKG-BUILD-01/02, PKG-IMPORT-01/02 |
| ARC-23 | PKG-MANIFEST-01, PKG-VERSION-01, PKG-VARIANT-01, PKG-INTEGRITY-01, PKG-RESTORE-01 |
| ARC-24 | PKG-DOWNLOAD-01/02, PKG-MANIFEST-01, PKG-INTEGRITY-01, PKG-WITHDRAW-01 |
| ARC-25 | PKG-IMPORT-01/02, PKG-SECURITY-01, PKG-TARGET-01, PKG-RECOVER-01 |
| ARC-26 | PKG-STATE-01, PKG-ACL-01, PKG-SECURITY-01, PKG-WITHDRAW-01, PKG-RESTORE-01 |
| ANF-01 | ARC-PERF-01, PKG-PERF-01, UE-BUDGET-01, ARC-E2E-05에서 파일/준비 시간 별도 기록 |
| ANF-02 | ARC-ORIGINAL-01, ARC-SCAN-05, ARC-ARCHIVE-02, ARC-DOWNLOAD-05, UE-BUDGET-01, PKG-RECOVER-01 |
| ANF-03 | ARC-SEC-01~03, ARC-SURVEY-04, ARC-SEARCH-02, ARC-DOWNLOAD-03/06, PKG-ACL-01, PKG-WITHDRAW-01 |
| ANF-04 | ARC-RESTORE-01/02, UE-RECOVER-01/02, PKG-RESTORE-01 |
| ANF-05 | ARC-LOG-01, ARC-SCAN-03, ARC-REUSE-02, ARC-DOWNLOAD-05 |
| ANF-06 | ARC-A11Y-01, ARC-SEARCH-01/02, ARC-PATH-02, ARC-DOWNLOAD-07 |

## 7 통합 시나리오와 업무 수용 시험

**ARC-E2E-01 / B1, 유지·보완:** 관리자 전용 공유 등록→dry-run→후보 검토→편집자 영상/프로젝트/R1 사용 관계 확인·전체 설명/키워드/메모 작성→방송연도 홈→검색→상세/프리뷰/서베잉→자산 역탐색→재조사. 동일 관계·방송연도·수동 기록 유지.

**ARC-E2E-02 / B0, 유지:** 제한 사용자의 숨긴 영상·서베잉·공유 자산 역참조·미디어·위치 접근 차단→계정 전환 중 이전 응답 도착→누출0→NAS 단절/복귀·조회 유지·자동 삭제0.

**ARC-E2E-03 / B1, UE 필수 유지:** 과거 영상→연결 UE→설치별 분석→Actor Sequence 포함 에셋/의존성→기존 제작 프로젝트 계획/이행→실제 대상 참조/Blueprint/map/시퀀스 재생→이력. 원본/기존 대상 보존·실제 엔진 증거 필요.

**ARC-E2E-04 / B0, UE 복구 유지:** 계획 후 대상 수정→재계획→네트워크 실패→journal 복구→같은 key 재시도→검증. 원본·타인 변경 보존.

**ARC-E2E-05 / B1, 제품 핵심:** 방송연도/종류/키워드 검색→과거 영상 시청→전체 설명/키워드/팀 메모에서 참고 근거 확인→confirmed 사용 FBX R1 또는 이미지 R1 선택→출처/의존성/제약/크기 확인→웹 원본 다운로드→브라우저 저장 파일 해시 대조→후속 제작 결과 수동 기록. 썸네일·R2·동일 폴더의 미사용 파일이 반환되면 실패다. 폴더 열기·PC 도우미·장면 구간·AI 없이 완주해야 한다.

**ARC-E2E-06 / B0, 보존/권한:** FBX R1 managed 보존→원본 R2 변경/NAS 단절→과거 영상은 R1과 서베잉 유지→허용 사용자 R1 다운로드·바이트 일치→권한 회수→후속 content/range 차단·타 사용자 job 접근 차단→백업 복구 후 관계/보존 바이트 대조.

**ARC-E2E-07 / B1, 팀 전용 Fab 필수:** 로켓·인공위성·지구·발사대 프로젝트 A→인공위성 root/animatedAssembly 선택→의존성·포함/제외 검토→패키지 v1/검증된 variant 빌드→독립 검증→게시→원본 A/NAS/빌드 workspace 차단→다른 팀원 라이브러리 검색/웹 ZIP 다운로드→깨끗한 호환 프로젝트 B에 추가→외형/재질/태양전지판 시퀀스 재현. 원본 파일 접근0·무관한 세 오브젝트 미포함·고정 hash·출처/이력 일치가 필수다.

**ARC-E2E-08 / B0, 패키지 실패/복구 필수:** 지구/전체 시퀀스 필수 참조가 남은 인공위성 게시 시도→blocked/이유 표시→작업 복제본에서 참조 분리/재검증→정상 패키지 게시→원본 오프라인·보존본 손상 주입→제공 차단→백업 복구·hash/권한/보고서 대조→독립 B 재현→게시 회수 후 content/range/이행 계획 실행 차단. 손상 artifact를 다른 bytes로 재생성해 같은 버전으로 위장하지 않는다.

팀 대표 과제 5개는 실제 업무에서 익명화/복제해 고른다. 과거 영상·서베잉, 확인된 FBX/이미지, 인공위성의 단독 재사용 패키지, 원본 단절/보존 복구, 기존 대상 UE 추가를 포함한다. ARC-E2E-07/08은 선택 시나리오로 제외하지 않는다. 다운로드 횟수와 실제 사용 성공을 구분하고 시간 목표는 기준 업무 측정 후 정한다.

## 8 구현 순서·릴리스 게이트

1. P0: 실제 폴더/자산·버전·사용 근거·다운로드/사용 제약 정책·보존/임시 공간을 확인한다. 실제 엔진/build별 무인 분석/기존 대상 이행 spike를 병행한다.
2. P1: ARC-SURVEY/USAGE/DOWNLOAD/SEC의 실패·버전/경쟁 사례를 먼저 작성→수동 영상/자산 모델·전체 서베잉·웹 다운로드→ARC-E2E-05. 설명·파일 위치 조회만으로 완료하지 않는다.
3. P2: ARC-SCAN/ARCHIVE/ORIGINAL/RESTORE와 PKG-UNIT/BUILD/MANIFEST/STATE/DOWNLOAD/ACL 실패 사례→조사·보존·패키지 카탈로그/게시/배포→ARC-E2E-01/02/06. 독립 UE 검증 전 variant 게시 금지, 메타데이터/원본/관리/임시 저장소 구분.
4. P3: PKG 패키지 사례·UE 실제 검증/복구→ARC-E2E-03/04/07/08·성능·복구·팀 과제. 최종 ZIP·원본 접근0으로 인공위성 재현 필수. UE/패키지는 범위 제외할 수 없고 이 단계 전 전체 1차 제품 완성으로 보고하지 않는다.
5. P4: 미채택 기능은 범위 제외로 명시한다. 장면 주석·AI·3D 뷰어·일반 폴더 복사/임의 대량 ZIP이 없어도 완주한다. 등록 패키지 ZIP은 1차 필수다. 도우미 채택 시 실제 Windows ARC-OPEN-01 활성화.

해당 단계 B0/B1 모두 통과·회귀 없음·원본 변경0·잘못된 버전 제공0·권한 누출0이 필수다. 다운로드/보존/UE 작업 성공과 실제 업무 성공은 별도 증거를 요구한다. 실행 불가/환경 미구축은 통과율에 포함하지 않는다. ANF 수치는 제안값이며 최종 합의값·하드웨어/콜드/네트워크를 기록한다. 영상/파일 수 추정 fixture를 실제 10TB 처리 완료로 보고하지 않는다.

NextFlix 회귀는 v2.1 보존본의 인증·DTO 안전성·캐시 격리·키보드·실제 영상 재생을 적용 범위에 맞춰 유지한다. 기존 코드의 비밀번호 해시 노출·잘못된 오류 분기를 합격 계약으로 고정하지 않는다. 현재 문서의 계약이 바뀐 부분은 신규 기대 결과로 판단하며 참고 영화 카탈로그·평점·외부 API는 제품 필수로 승계하지 않는다.

## 9 실행 기록·현재 검증 상태

결과는 요구/test ID·환경·snapshot·source fingerprint·권한·survey/사용 관계·assetRevision·package/version/variant/reuseGoal/qualifiedProfile·build/archive/download/migration jobId·manifestHash/artifactHash/파일 checksum·독립 검증 보고서·원본 접근 차단/감사 증거·전후 파일 대조·실제 결과/복구로 남긴다. 발급/전송/사용자 저장/실제 제작 사용을 구별한다.

2026-10-17 v4.0은 **목표 설계**다. 기존 영상/원본/UE 사례를 보존하고 독립 패키지·manifest·variant·게시·권한·ZIP·원본 차단 인공위성 재현·복구를 추가했다. 문서 구조·링크·ID 추적을 정적 점검하며 실제 API/DB/SMB/브라우저 다운로드/UE 테스트·의존성 설치·원본 조사·배포는 수행하지 않았다. 모든 실행 사례는 미실행이다.
