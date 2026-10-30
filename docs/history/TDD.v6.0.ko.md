# 제작 결과물·제작 소스 아카이브 테스트 설계 문서 TDD

TDD는 **Test Design Document**다. 사용자가 Netflix형 결과물 화면에서 **찾기 → 필요시 연결 소스 확인 → 다운로드**하는 흐름과, 관리자의 **업로드 → 자동 새 버전 → 수정 교체/승계 → 확인 후 삭제**를 검증한다. PostgreSQL+JSONB와 별도 NAS 보존을 실제 통합 대상으로 삼는다.

| 항목 | 기준 |
| --- | --- |
| 버전·작성일 | 6.0 / 2026-10-29 (Asia/Seoul) |
| 대상 설계 | [SDD](SDD.v6.0.ko.md) AR-01~24·NFR-01~08 |
| 사용자 확정 | 별도 NAS 보존·자동 업로드 버전·수정 시 중복 교체·기본 동시 삭제·공유 소스 보존/연결 해제 |
| UE 목표 | 제작 영상·이미지와 재편집 프로젝트, 재생성 캐시만 제외·미사용 Content 보존·실행용 빌드 없음 |
| 이력 | [SDD v5.2](SDD.v5.2.ko.md), [TDD v5.2](TDD.v5.2.ko.md) |
| 현재 결과 | 테스트 설계 및 정적 문서 점검. 기능·DB·NAS·업로드/삭제·UE 시험은 모두 미실행 |

## 1 판정 원칙

결과물 중심 탐색·연결 소스·다운로드를 기본 사용자 E2E로 삼는다. 이미지 단독 제작 건도 필수다. 업로드는 확정한 한 작업마다 자동 새 버전이며 수정 파일은 새 버전에서만 교체한다. 과거 버전은 명시 삭제를 확인하기 전까지 유지한다. 같은 멱등 키 재요청은 새 버전이 아니다.

원본 PC/제작 NAS는 읽기 전용이다. 사용자가 확인한 별도 보존 NAS의 파일 삭제는 이번 필수 범위다. 이전의 '삭제0' 판정은 **원본/미승인 보존본 삭제0**으로 해석하며 확인된 삭제까지 금지하는 근거로 쓰지 않는다. 공유 소스는 보존하고 해당 결과물 연결만 제거한다.

B0는 원본 훼손·권한 노출·데이터 손실·거짓 보존/공개/삭제 완료, B1은 핵심 업무, B2는 보조 품질이다. 수준 U(단위), C(컴포넌트), I(실제 API/PostgreSQL/NAS/worker), E(브라우저), UE(실제 등록 엔진)다. mock로 실제 DB 제약/SMB 삭제·복원/UE 열기 증거를 대체하지 않는다. 선택 후속 Fab/자동 UE 이행/AI/3D 뷰어는 릴리스 분모에서 제외한다.

## 2 실행 환경·fixture

운영 원본과 분리한 전용 PostgreSQL DB·SMB source/archive/staging/preview/restore 공유를 사용한다. 삭제/장애 시험은 전용 fixture에서만 실행한다. 원본 fixture의 전후 hash·크기·mtime·생성/삭제 감시와 보존 NAS의 실제 파일 목록/상태를 기록한다.

Jest/React Testing Library/MSW·Playwright·실제 Next API·PostgreSQL·파일 worker·등록 UE 환경을 제안한다. 현재 [package.json](../../package.json)에는 runner/테스트 스크립트가 없으며 이번 문서 작업에서 설치하지 않는다. Prisma schema의 현행 MongoDB와 PostgreSQL 목표를 혼동하지 않는다. OS/Node/lockfile/브라우저/PostgreSQL major/SMB·권한/공간·engine build/plugin/toolchain을 실행 증거로 남긴다.

| fixture | 내용 |
| --- | --- |
| F-RESULT | 방송연도2023/2024/미상, 영상·결과 JPG/PNG·영상 없는 이미지 제작 건·갤러리 |
| F-SOURCE | FBX/소스 이미지/문서/오디오/폴더/UE·결과/소스 두 역할·미지원/원본 offline |
| F-VERSION | v1/v2·같은 이름 다른 bytes·다른 경로 같은 hash·버전별 관계·메모/revision |
| F-UPLOAD | part 재전송/중단/만료·잘못된 hash·동일 key·별도 key 같은 bytes·다중 item 배치·2GB 초과 파일·BIGINT 경계 metadata |
| F-OVERLAY | 기준 전체 파일집합·동일 경로 교체/추가/미전송 승계/명시 제거·NFC/case 충돌·낡은 base |
| F-UE-SOURCE | .uproject/Config/Content·map/외부 actor/동반 파일·Source/Build 입력·plugin source/content/config |
| F-UE-CACHE | 프로젝트/plugin Intermediate·DDC/공유 DDC·Saved Logs/Crashes·IDE 캐시·재생성 가능한 Binaries |
| F-UE-EXCEPTION | binary-only plugin/DLL/ThirdParty·필수 Saved 설정/고유 autosave·프로젝트 밖 미디어/3D |
| F-UE-NAMES | Content/Intermediate·Content/Saved 실제 자산·한글/공백/case·미분류 파일 |
| F-UE-ENV | 실제 사용 UE5.3/5.4/5.6/5.8·Launcher/Custom·Actor Sequence·C++·없는 환경 |
| F-JOBS | 원본 쓰기 중·SMB 단절·공간 부족·lease 만료·DB/NAS commit 장애·중복 작업 |
| F-ACCESS | 관리자/편집/조회·upload/delete 권한 차이·타 팀/제작 건·ID/plan 위조·계정 전환 |
| F-DELETE | 전용 소스·다른 결과물/과거 버전 참조 공유 소스·역할 중복·공유 object·활성 전송·삭제 중 추가 참조·부분 삭제 |
| F-POSTGRES | UUID/FK/UNIQUE/CHECK·고아/타 팀 참조·JSONB 잘못된 타입/버전·BIGINT·동시 채번/대표 전환 |
| F-MIGRATION | 익명화 Mongo User/Account/Session/Movie/Favorite·ObjectId 대응·미상 메타데이터·불량/고아 자료·재실행·전환 후 신규 쓰기 |
| F-RESTORE | 원본 offline·NAS 정상/손상·DB+NAS+삭제 원장 백업·새 작업 위치·기존 파일 위치 |
| F-SCALE | 영상+이미지5,000/파일100,000/동시10명 임시값. 실제10TB 전수 증거와 구별 |


## 3 결과물 UI·소스·버전 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| CAT-01 | B1 C/I/E | 영상+이미지 혼합/유형 필터·방송연도 행/전체 보기 → 두 미디어의 카드/유형 badge·제목·보존 상태·미상 행, 빈 연도 숨김 |
| CAT-02 | B1 E | 영상 없는 제작 건에 이미지들만 등록→홈/직접 상세/새로고침 → 이미지 카드·확대/갤러리, video 요청/없는 영상 오류 없음 |
| CAT-03 | B1 I/E | 제목·설명/메모·키워드·종류·담당/부조·연도 검색, 한글IME·공백/NFC·이전 응답·URL 복원 → 리터럴/조건 교집합·현재 결과·페이지 초기화 |
| CAT-04 | B1 I/E | 혼합 결과를 limit24 끝까지 조회·다른 유형/권한/필터 cursor·이미지연도와 수정일 차이 → 정적 누락/중복0·잘못된 cursor400·방송연도 기준 |
| CAT-05 | B1 E | 키보드/터치 카드·상세·이미지 갤러리·재생·다운로드·뒤로가기·reduced motion → 접근/초점 복귀, 자동 음향 없음 |
| SRC-01 | B1 I/E | 3D/소스 이미지/기타 파일/폴더/UE 등록·연결·역탐색 → 모든 소스 유형 도달, 확장자/파일명만으로 실제 사용 확정하지 않음 |
| SRC-02 | B1 I/E | 같은 PNG를 결과·소스 역할로 연결(공유 삭제 충돌은 DEL-04), 파생 썸네일도 존재 → 역할 구분·원본 버전 공유 가능, 파생물을 제작 원본으로 오표시하지 않음 |
| VER-01 | B0 I | v1 보존 후 원본 v2·필터 정책 변경·같은 이름 다른 파일 → 새 item/archive 버전·기존 bytes/manifest/관계 불변, 확인 없는 덮어쓰기/삭제0 |
| VER-02 | B1 I/E | 수동 설명/키워드/메모 작성→동시 수정·재조사·대표 버전 변경 → 오래된 revision409·확정값/이전 버전 메모 유지·작성자/근거 표시 |

### 3.1 업로드·수정·자동 버전

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| UPL-01 | B1 I/E | 새 영상/이미지/소스 파일 묶음 업로드→검증/배치 확정 → 서버 자동 v1·한 저장에 버전1개·ready 후 대표, 파일/part 수만큼 버전 증가0 |
| UPL-02 | B0 I/E | 기준v1에 같은 상대경로 새 bytes·새 경로·미전송 파일을 섞어 업로드 → v2의 교체/추가/승계 정확·v1 bytes/manifest/링크 불변·승계 파일 재업로드/전체 재복사 불필요 |
| UPL-03 | B0 U/I/E | 파일명 같고 폴더 다름·동hash 다른 경로·NFC/case 중복·같은 입력 경로2개·../ 및 절대경로 → 경로 기준 구별·모호 충돌409/review·경로 탈출0·조용한 last-write-wins0 |
| UPL-04 | B0 I/E | 청크 중단/재개·같은 part/hash 재송·다른 bytes·offset 겹침·누락·만료·클라이언트 위조hash → 멱등 part/정확 재개·409/410·전체 서버 hash 검증·잘린 공개0 |
| UPL-05 | B0 I/E | 전송/검증 중 취소·공간 부족·권한 회수·실패 → 새 공개 버전0·기존 대표/다운로드 유지·staging만 안전 정리·실패를 업로드 완료로 표시0 |
| UPL-06 | B0 I | 동시 편집2건·base 변경·중복 commit·삭제 요청과 경쟁 → 오래된 base/revision409·자동 rebase0·채번 중복0·정확한 대표·삭제 중 공개0 |
| UPL-07 | B0 I | NAS object 승격 전후/DB 확정 전후 crash·lease 만료·재시도 → journal 대조·배치 공개 원자성·orphan 비공개/보호·과거 bytes 불변·거짓 ready0 |
| UPL-08 | B1 I/E | 동일 bytes로 별도 업로드2회·같은 멱등 key 완료 재송 → 별도 확정은 vNext, 같은 작업 재송은 동일 version/job·사용자 수동 채번 없음 |
| UPL-09 | B0 I/E | 결과물+연결 소스 동시 수정·소스만 단독 새 업로드·배치 일부 실패 → 전체 필수 배치만 원자 공개·새 결과물은 새 소스 버전 연결·과거 결과물 링크 자동 추종0·부분 공개0 |
| UPL-10 | B0 I/E | UE 목록 선전송→정책 검토→include 전송·캐시 위장/필수 누락·대용량/크기 정밀도·브라우저 폴더 미지원 → 서버 재검사·캐시 영구 보존0·미해결 review 차단·NAS 대안·정확한 BIGINT |
| UPL-11 | B0 I/E | 새 버전에 일부 파일 명시 제거·미전송 파일 혼재·UE 필수 제거 시도 → 지정 파일만 새 manifest에서 제외·미전송 승계·과거 버전 유지·필수 누락/review는 확정 차단 |
| VER-03 | B1 I/E | 파일 없이 설명/분류/키워드/메모만 수정→revision 충돌·재조회 → metadata 이력 갱신·파일 버전 증가0·원본/manifest 변경0 |


## 4 조사·계획·별도 저장소 보존 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| PLAN-01 | B1 I/E | 승인 루트 dry-run·정책 적용→include/exclude/review 계획 → 파일별 이유·규칙 버전·파일 수/바이트·절감 예상량, 실행 전 원본/보존 bytes 변화0 |
| PLAN-02 | B0 U/I | 기본 제외+필수 보존 예외·필수 review 미해결·정책 변경·plan hash 위조 → 예외 우선·미해결 실행 차단·stale409, 확정 이후 조용한 목록 변경 없음 |
| PLAN-03 | B0 I | 최종/임시 공간 부족·아카이브=원본/중첩·허용 루트 탈출/junction → 복사 전 차단·원본 변화0·외부 읽기/쓰기0 |
| SCAN-01 | B1 I | 정상/부분/권한 거절/단절/제외 규칙 변경·원본 복귀 → completed/partial/failed 구분·누락 카운트 오증가0·자동 삭제0·메타데이터 유지 |
| SAVE-01 | B0 I | 일관된 source snapshot에서 계획 실행·복사/검증 → **별도** 저장소에 포함 bytes/경로/크기/checksum·manifest 일치, 미포함 파일 미복사, 원본 변화0 |
| SAVE-02 | B0 I | 계획 후 파일/집합 변경·복사 중 쓰기·크기/mtime 변경 → stale/needsReplan·해당 버전 완료 금지, 다른 원본 bytes로 대체0 |
| SAVE-03 | B0 I | 복사/검증/commit 각 단계 중단·단절·취소·checksum 불일치 → partial/failed·잘린 보존 완료0·기존 버전 유지·journal 복구 가능 |
| SAVE-04 | B0 I | 같은 key 재실행/동시 작업·lease 만료 worker의 늦은 결과 → 중복 보존/같은 루트 동시 실행 차단·fencing·checkpoint/재시도 멱등 |
| SAVE-05 | B0 I | 물리 파일 commit 직전/후 DB 실패·DB만 있는 상태·임시 정리 → verified 허위 표시0·orphan 보고/안전 재개·임시와 영구 보존본 분리 |
| SAVE-06 | B1 I | 공유 hash·다른 제작 관계·버전·정상 조사 재실행 → 논리 관계/권한 유지, 파일명/hash만으로 항목 병합·원본/보존본 중복 삭제 없음 |

## 5 Unreal 필수 보존·불필요 제외·예외 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| UEF-01 | B0 U/I | F-UE-SOURCE 정책 적용/복사 → `.uproject/Config/Content/Source`·authored Build/Shader/Resources·프로젝트 plugin 핵심 자료/ThirdParty 유지. Build를 캐시로 제외하지 않음 |
| UEF-02 | B1 U/I/UE | F-UE-CACHE의 검증된 생성 파일 계획/보존→복원 → DDC/Intermediate/실제 불필요 로그/IDE 캐시 보존0·필요시 새 복원 위치에서 재생성, 원본 삭제0 |
| UEF-03 | B0 I/UE | 바이너리 전용 plugin과 소스/환경으로 재생성 가능한 plugin의 Binaries 각각 적용 → 전자는 필수 bytes 포함, 후자는 근거 있는 산출물만 제외. 전역 Binaries/DLL 차단 금지 |
| UEF-04 | B0 I | Saved/Config·유일 autosave/backup·로그 혼재 → 고유/기능 필수 자료 review·검토/보존 예외, 불필요 로그 제외. Saved 전체 무검토 제외/미해결 완료 금지 |
| UEF-05 | B0 I/UE | 프로젝트 밖 영상/이미지/오디오·원본3D 등록→승인 위치에서 보존·복원 → 실제 bytes·상대 복원/재연결 방법 포함, 경로 문자열만으로 열기 성공 표시하지 않음 |
| UEF-06 | B0 U/I | F-UE-NAMES·미분류 파일·실제 자산의 특이 확장자 → 루트/플러그인 경로 기준 평가, Content 아래 이름 충돌 자료 보존·미분류 review, 캐시 규칙의 범위 탈출0 |
| UEF-07 | B0 I | 현재 참조되지 않은 map/asset·아직 제작에서 쓰지 않은 Content·외부 actor/동반 파일 → 자동 가지치기0·전체 보존 범위 유지, 보존과 개별 에셋 추출 혼동0 |
| UEF-08 | B1 I | 캐시/중간 파일 포함 원본 계획과 실측 보존본 대조 → include/exclude/review 합계/바이트·절감 산식 일치, 미열거/접근 거절이 있으면 완전 절감률로 오표시하지 않음 |
| UEF-09 | B1 I/E | 엔진/커스텀 build/플러그인/toolchain/대표 map·고유 binary 기록·없는 환경 → 정확한 요구/불변 복구 참조, 버전 숫자만으로 검증 완료0·environmentMissing 표시 |
| UEF-10 | B1 UE | 원본/원본 캐시 접근 차단·필터된 보존본을 새 위치에 복원→기록된 환경으로 열기·대표 map/material/Actor Sequence·필요 Editor C++ 모듈 재빌드 → 결과/환경 증거 기록·보존 원본 불변. 배포용 실행 프로그램 생성 요구 없음 |
| UEF-11 | B1 I/E | 파일 검증 완료이나 UE 미실행/환경 없음/실제 열기 실패 → 보존 verified와 복원 notTested/environmentMissing/failed 분리, 재편집 가능 허위 표시0 |
| UEF-12 | B0 I/E | 실행용 빌드 없이 에디터 출력 영상·이미지(일부 Saved 하위)와 프로젝트 원본 등록/보존 → 결과물 bytes·Content/Source/Config/필수 plugin 유지, 캐시만 제외. 실행 프로그램 없음은 정상·오류/새 빌드 요구0·렌더 결과물을 재생성 가능 캐시로 제외0 |

사용자는 에디터에서 작업하고 영상·이미지만 출력했으며 별도 실행 프로그램을 만들지 않았다고 확인했다. 실행용 빌드의 보존·생성·실행 검증은 대상이 아니다. ‘영상·이미지 출력물 보존’과 ‘에디터에서 다시 열어 수정할 수 있는 프로젝트 복원’을 함께 검증한다. 필요한 Editor 모듈/plugin binary·Build 입력 보존과 별도 배포용 실행 프로그램을 혼동하지 않는다.

사용자가 재생성 가능한 파일만 제외한다고 확인했다. 따라서 UEF-07의 미사용 Content 보존은 확정 수용 조건이다. 현재 map에서 참조되지 않음·에셋 사용 횟수0·이름/용량만을 근거로 Content를 제외하는 구현은 실패로 판정한다. 원본 삭제나 자동 에셋 가지치기는 구현 범위가 아니다.

## 6 파생·다운로드·복원·권한·운영 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| VIEW-01 | B1 I/E | 서로 다른 영상 proxy/frame·실제 재생/seek·손상/미지원 코덱 → 올바른 영상·상태·206/416·파생 실패에도 메타데이터/원본 보존 유지 |
| VIEW-02 | B1 I/E | JPG/PNG 결과/소스 이미지·여러 원본·고해상도/손상/미지원 편집 형식 → 올바른 썸네일/갤러리·유형/해상도/미지원 안내·원본 bytes/색상 정보 보존·파생을 원본으로 반환0 |
| DOWN-01 | B0 I/E | 영상·제작 이미지·3D·소스 이미지·기타 단건 원본 다운로드·브라우저 저장 파일 대조 → 정확한 archiveVersion·파일명·attachment·크기/hash, preview/다른 버전 아님 |
| DOWN-02 | B0 I/E | UE/폴더 전체 보존본 다운로드→해제→manifest/필터 결과 대조 → 포함 구조/bytes·필수 binary/외부 자료 유지·불필요 캐시0·원본 프로젝트 재읽기0 |
| DOWN-03 | B1 I/E | 준비 중/실패/만료·중단/같은 객체 range 재개·잘못된 range → ready 이전 content409·만료410·206/416·같은 validator·잘린 파일 성공0 |
| REST-01 | B0 I | 새 위치 복원·해제 경로 탈출/절대/case충돌/symlink/과다 용량·기존 자료 있는 대상 → manifest 먼저 대조·안전 차단·원본/기존 프로젝트 덮어쓰기0 |
| REST-02 | B1 I/UE | 복원 manifest 대조→UE 열기 후 DDC/Intermediate 재생성 → 보존 저장소는 불변, 새 복원 공간의 정상 재생성 파일을 보존 오염/누락으로 오판하지 않음 |
| REST-03 | B0 I/E | 원본 NAS 단절/변경/제거 후 보존 자료 열람/다운로드/복원 → 별도 보존본·설명/메모·관계/버전 사용, 원본 offline을 보존 유실로 오표시하지 않음 |
| SEC-01 | B0 I/E | 비인증/타 팀/미허용 제작 건으로 결과·이미지·소스·건수·미디어·위치·manifest·job·다운로드 요청 → 401/403/404·비허용 bytes/경로/파일명 노출0 |
| SEC-02 | B0 I/E | 조회자 정책/plan 변경·위조 source/team/job ID·계정 전환 중 지연 응답 → 권한/소유 검사·DB/파일 변화0·이전 계정 캐시/다운로드 상태 누출0 |
| SEC-03 | B0 I | 일반 복원 manifest vs 관리자 제외 보고서·로그·오류·메모 스크립트 → 내부 루트/비밀/비공개 제외 파일명 노출0·안전 텍스트·request/job 추적 |
| OPS-01 | B1 I/E | 파일 준비/보존/파생 병행·동시10명 metadata 탐색 → NFR-01 제안 측정·콜드/하드웨어/네트워크 분리·자원 제한·예상 아닌 실측 기록 |
| OPS-02 | B0 I | DB/설명/메모/관계/정책/예외/manifest/보존 bytes 백업 복구→이미지/소스/UE 다시 확보 → ID·권한·checksum 일치, DB만 복구하고 전체 완료 주장0 |
| OPS-03 | B1 I | 원본/보존/파생 저장소 개별 단절·손상·미디어 timeout·공간 부족·복구 → 저장소별 상태/오류·보존 무결성 재검사·재생성 범위 분리·원본/미승인 보존 삭제0 |

## 7 PostgreSQL·JSONB·이행 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| DB-01 | B0 I | 실제 DB에 고아/타 팀 FK·다른 item의 대표/base·삭제 FK CASCADE 시도 → FK/상태 제약 거절·같은 팀이라도 제작 건 권한 별도 확인·NAS 무단 삭제0 |
| DB-02 | B0 I | 같은 item/version_no·보존 경로/object key/part 중복·음수 크기·미상 연도·동시 채번·BIGINT API → UNIQUE/CHECK·NULL 처리·정확한 수치/문자열·중복/대표 오지정0 |
| DB-03 | B0 U/I | JSONB 타입/깊이/크기/schema_version 위반·신규 codec/engine 정보·FK/권한 ID를 JSONB에 주입 → 검증 거절/지원 버전 정책·권한 우회0·관계는 실제 FK로 보호 |
| DB-04 | B0 I | 공개 version의 파일 목록/소스 연결·manifest를 직접 갱신·상태만 ready 위조·허용 metadata 수정 → 서비스/DB 보호·확정 삭제 외 payload/manifest 변경0·metadata 이력 유지·대표는 검증된 활성 버전 |
| DB-05 | B1 I | F-SCALE의 연도/유형/프로젝트/키워드·리터럴 부분검색·JSONB 조건 → 정확한 결과/권한·EXPLAIN/인덱스 계획·NFR 실측, 테스트 fixture만으로10TB 처리 완료 주장0 |
| DB-06 | B0 I | 미변경 object 승계·변경 object 신규 생성·JSONB roundtrip·대량 파일목록·manifest 대조 → FK 참조 재사용·원래 경로 복원·canonical bytes/hash 일치·JSONB 키 순서에 hash 의존0·파일 bytes DB 적재0 |
| MIG-01 | B0 I | Mongo 익명화 snapshot을 PostgreSQL 신규DB에 import2회 → ObjectId↔UUID 고유/멱등·사용자/인증hash/provider/session/favorites 참조·건수 대조, 비밀 로그 노출0 |
| MIG-02 | B0 I | 고아/중복/잘못된 타입·없는 방송연도/소스·외부 Movie URL → 명시 검토/격리·임의값 생성0·URL 자동 fetch0·NAS 검증 전 verified0 |
| MIG-03 | B0 I | 쓰기 중지/최종 증분/전환·전환 직전 실패·전환 후 새 upload/delete 발생 후 롤백 모의 → 백업/대조·신규 데이터/삭제 원장 보존, URL만 바꾸어 쓰기 유실0 |
| MIG-04 | B0 I | PostgreSQL+NAS 다른 시점 백업·restore/삭제 원장 재적용 → ID/FK/object/manifest 대조·누락 보고·삭제 콘텐츠 자동 재공개0·로그인/즐겨찾기/다운로드 재검증 |

## 8 삭제 확인·전용/공유 소스·물리 정리 테스트

| ID | 중요도/수준 | 절차·기대 결과 |
| --- | --- | --- |
| DEL-01 | B0 C/I/E | 영상/이미지 삭제창 열기→기본 선택/전 버전·용량/전용·공유 확인→취소/닫기 → 동시 삭제 기본·결과물만 선택 가능·명시 확인 전 DB/NAS 변화0 |
| DEL-02 | B0 I/E | 전용 소스만 있는 결과물의 기본 동시 삭제 확인 → 결과물/직접 전용 소스의 모든 버전·보존 bytes·파생/임시 배포물 제거·최종 NAS 부재 증거·원본 PC/제작NAS 변화0 |
| DEL-03 | B0 I/E | 결과물만 삭제 선택·확인 → 결과물 전 버전/bytes·파생 삭제, 전용/공유 소스 항목·보존 파일 유지·해당 결과물 링크만 해제·카드 숨김만으로 완료0 |
| DEL-04 | B0 I/E | 다른 결과물/과거 버전이 참조하는 소스·독립 관리 소스·다른 제작 건/비허용 관계·대상 결과물 자체가 공유 소스인 경우 → 공유 bytes/기존 링크 보존·현재 연결만 제거·비허용 이름 노출0·자기 공유 충돌은 계획409로 보호 |
| DEL-05 | B0 I/E | 삭제 권한 없는 사용자·일부 소스 권한 없음·위조 scope/plan hash/revision·미확인 요청 → 거절/범위 재확인·임의 제외/확대 삭제0·권한 없는 파일/정보 변화0 |
| DEL-06 | B0 I | 삭제 plan 후 새 참조/업로드/대표 변경·confirm2회·복수 결과물 동시 삭제·lease 만료 worker → 잠금 순서/재검사·stale409·멱등 request·fencing·삭제 중 신규 공개/참조0 |
| DEL-07 | B0 I/E | NAS 단절/파일 잠금/거절·일부 제거 후 crash·재시도 → waiting/partial/failed·보존 실패 파일 목록·이미 제거된 파일 멱등 처리·미제거 완료0 |
| DEL-08 | B0 I/E | 활성 원본 다운로드/복원 lease 중 삭제·준비/완료 ZIP·이전 media/content/range URL 재요청 → 활성 전송 종료/기한까지 보호·신규 제공 차단·410/404·늦은 worker 재개 차단·임시 bytes도 정리 |
| DEL-09 | B0 U/I | object key 경로 위조·archive/source 루트 중첩·junction/symlink·DB행만 삭제/전체 폴더 재귀삭제 시도 → 승인 루트/manifest 객체만 처리·원본/관계없는 bytes 삭제0·DB상태만 완료0 |
| DEL-10 | B0 I | v1/v2 승계 object·다른 유지 항목 공유 object·draft 예약 참조·참조 count 캐시 불일치 → 실제 참조/lease 검사·참조 남으면 bytes 보존·최종 참조 해제 시에만 제거·회수 바이트 중복 계산0 |
| DEL-11 | B0 I/E | 계획 취소·확인 후 첫 물리 삭제 전 취소·첫 제거 후 취소 → 가능한 단계만 안전 취소/상태 복원·부분 삭제를 되돌렸다고 표시0·삭제 완료 후 즉시 복구 보장0 |
| DEL-12 | B0 I | 삭제 확인 직후/DB상태 기록 직전 crash·파일 이미 없음·최신 삭제 원장으로 백업 복구 → 행별 재대조/감사·중복 요청 동일 결과·미승인 부재는 성공으로 은폐0·삭제 결과물 자동 부활0 |

삭제 완료는 확인 범위의 결과물/전용 소스가 제거되고 공유로 남겨야 할 자료는 유지되는 상태다. 공유 객체를 남겼다는 이유로 전체 물리 회수량을 논리 용량과 같게 표시하지 않는다. 반대로 NAS 삭제 실패를 카드가 사라졌다는 이유로 완료 처리하면 실패다. 기본 선택은 서버의 명시 확인/권한/계획 검사를 생략하지 않는다.

## 9 요구사항 추적표

| 요구 | 주요 테스트 |
| --- | --- |
| AR-01 | CAT-01/02/04/05, UEF-12 |
| AR-02 | CAT-03/04, DB-05, SEC-01 |
| AR-03 | CAT-02, SRC-01/02, VIEW-01/02, UEF-11 |
| AR-04 | SRC-01/02, UEF-01/05/07, UPL-09 |
| AR-05 | VER-01/03, UPL-02/09/11, SAVE-06, DEL-02~04 |
| AR-06 | PLAN-01/02, UEF-08, UPL-10 |
| AR-07 | SAVE-01~05, PLAN-03, UPL-04 |
| AR-08 | UEF-01~08, UEF-12, UPL-10/11, REST-02 |
| AR-09 | SAVE-01/03/05, DB-06, DOWN-02, UPL-07 |
| AR-10 | SCAN-01, REST-03, UEF-11 |
| AR-11 | VIEW-01/02, CAT-02/05 |
| AR-12 | DOWN-01~03, SEC-01/02, DEL-08 |
| AR-13 | REST-01~03, UEF-09~12 |
| AR-14 | VER-02/03, CAT-03, SEC-03 |
| AR-15 | SEC-01~03, PLAN-03, UPL-05, DEL-05 |
| AR-16 | VER-01~03, SAVE-06, PLAN-02, UPL-06 |
| AR-17 | SCAN-01, SAVE-02~05, UPL-04~07, DOWN-03, DEL-07/11, OPS-03 |
| AR-18 | OPS-02/03, SAVE-05, MIG-04, DEL-12 |
| AR-19 | DB-01~06 |
| AR-20 | UPL-01/04~10, DB-02 |
| AR-21 | UPL-02/03/06/09/11, VER-03, DB-06 |
| AR-22 | DEL-01~05 |
| AR-23 | DEL-04~12, DB-01/06 |
| AR-24 | MIG-01~04 |
| NFR-01 | OPS-01, CAT-04, DB-05 |
| NFR-02 | PLAN-01/03, UEF-08, OPS-01, UPL-10, DEL-10 |
| NFR-03 | SAVE-01~03, PLAN-03, SEC-01~03, REST-01, UPL-03, DEL-05/09 |
| NFR-04 | SAVE-03~05, UPL-05~07/09, DEL-06~12, OPS-03 |
| NFR-05 | CAT-03/05, VIEW-01/02, DOWN-01, UPL-03/04, DEL-01 |
| NFR-06 | PLAN-01/02, SEC-03, OPS-02/03, MIG-03/04, DEL-07/12 |
| NFR-07 | DB-01~06, UPL-06/09, MIG-01~04 |
| NFR-08 | UPL-02/07, DB-06, DEL-06/08/10 |

## 10 통합 시나리오·단계별 게이트

**E2E-A / B1, 결과물→연결 소스→다운로드:** 제작 건·영상/이미지·FBX/소스 이미지/기타/UE를 등록·별도NAS 검증→방송연도 카드/검색→결과물 상세→필요시 연결 소스 펼치기→결과물 또는 고정 소스 버전 다운로드→hash 대조. 모든 유형/권한·보존 상태 일치.

**E2E-B / B1, 이미지 단독:** 영상 없는 제작 건→제작 이미지/연결 소스 업로드·v1→이미지 카드/갤러리·설명/메모→원본 다운로드. video 강제 요청/영상 없음 오류0.

**E2E-C / B0, UE 필수 보존·복원:** source/C++·Content/Config/Build·binary-only plugin·외부 미디어·Saved 결과/설정·캐시 혼재→정책/review→include만 별도NAS→원본/캐시 차단→전체 보존본 다운로드·새 위치 해제/manifest→등록 엔진 대표 map/Sequence/Editor 모듈 확인. 실행용 프로그램을 새로 만들지 않음.

**E2E-D / B0, 장애·버전·백업:** 전송/보존 중 단절·취소→부분 공개 금지→멱등 재개→v2→원본 offline→v1/v2 다운로드→보존 손상/백업 복구. manifest/관계/bytes·삭제 원장 재대조.

**E2E-E / B0, 권한:** 제한 사용자·계정 전환으로 결과/이미지/소스/위치/manifest/upload/job/download/delete 직접 요청→거절·지연 응답 누출0→허용 사용자의 정상 다운로드. NAS 서비스 계정 권한 승계0.

**E2E-F / B0, 수정 업로드:** v1 파일집합 보존→편집 화면에서 동일 경로 교체/새 경로 추가/기존 승계·명시 제거 확인→업로드 중단/재개→검증/자동v2→두 버전 각각 다운로드·hash→별도 재업로드v3·동일 key 재시도는v3 유지→낡은 base409. 동시 소스 수정은 배치 전체 공개.

**E2E-G / B0, 기본 동시 삭제:** 전용/공유 소스가 섞인 결과물→삭제창 기본/모든 버전·남는 공유 확인→취소 시0→확인→신규 접근 차단/활성 lease 대기→NAS 일부 실패·재시도→결과물+전용 소스 실제 제거·공유 소스와 다른 결과물 다운로드 유지·원본 불변. 별도 결과물은 '결과물만' 삭제도 검증.

**E2E-H / B0, PostgreSQL 전환:** 익명화 Mongo snapshot→UUID/FK/JSONB/인증/즐겨찾기 멱등 이행→건수·관계·NAS 대조→쓰기 정지/전환→로그인·카드·자동 버전·다운로드·삭제→전환 후 쓰기를 포함한 롤백 모의/백업 복구·삭제 콘텐츠 자동 부활0.

A단계에서 표본·스키마/정책/삭제 범위를 확정하고 B단계 탐색/권한, C단계 업로드/보존/버전/다운로드, D단계 PostgreSQL 이행·삭제·실제 SMB/UE/백업/성능을 검증한다. 해당 단계 B0/B1은 전부 통과해야 한다. 실제 환경이 없으면 미실행/환경 차단이지 통과가 아니다.

## 11 결과·검증 상태

실행 결과에는 requirement/test ID·OS/도구/DB/SMB·사용자/권한·upload batch/session/part·base/revision·item/version·policy/plan/manifest hash·include/exclude/승계/교체 수량/바이트·object/lease·job/fencing·원본 전후 대조·download/restore hash·UE 실제 열기·delete scope/공유 보존/purged 증거·migration mapping/대조·백업/삭제 원장을 기록한다.

2026-10-29 v6.0은 PostgreSQL+JSONB/NAS·결과물 중심 흐름·자동 버전/수정 overlay·삭제 기본 동시/공유 보존을 반영한 목표 테스트 설계다. 문서 구조·요구/테스트 추적·링크·상호 정책 일치만 정적 점검한다. 코드·DB migration·NAS 조사/전송/삭제·기능/브라우저/UE/성능 시험·의존성 설치·배포는 수행하지 않았으며 실행 사례는 모두 미실행이다.

정적 점검 완료: 요구사항32개·테스트79개 전체 연결, 테스트/요구 ID 중복0·없는 참조0, E2E8개, 현행/신규 이력 문서4개의 로컬 링크19개 정상·코드 블록/인코딩 정상. UE 보존 정책 유지도 대조했다. **79개는 설계 사례 수이며 실행 통과 수는 아니다.**
