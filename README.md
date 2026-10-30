# NextFlix Archive

소규모 방송 제작팀의 결과물과 재편집 가능한 제작 원본을 보존하는 웹 프로젝트입니다. 방송연도별 카드에서 영상·이미지를 찾고, 상세에서 연결된 FBX·이미지·기타 파일·Unreal 프로젝트를 확인하여 원본을 다운로드합니다.

**화면: AV1(WebM) 동영상 + WebP 이미지/포스터. 보존: 별도 NAS의 원본 파일. 메타데이터: PostgreSQL + JSONB.**

## 로컬 실행

Node.js 22 이상(검증: Windows / Node 24), npm을 사용합니다.

~~~powershell
npm ci
npm run dev:local
~~~

http://localhost:3000/auth 에서 첫 관리자와 팀을 생성합니다. 초기 설정 키는 실행 로그에 안내되는 **.local/dev-secrets.json의 bootstrap 값**입니다. 이 파일은 비밀 파일이며 Git에서 제외됩니다. 데모 계정이나 기본 비밀번호는 없습니다.

개발 모드는 .local 아래 PostgreSQL 호환 PGlite와 보존·임시·미리보기 폴더를 만들고 웹 프로세스 안에서 worker를 실행합니다. Ctrl+C로 종료합니다. 실제 제작 NAS는 기본적으로 연결하지 않습니다. LOCAL_DATA_ROOT로 개발 자료 위치를 바꿀 수 있습니다.

PGlite는 로컬 개발용입니다. 개발 모드에서 별도 npm run worker나 별도 Prisma 연결 프로세스를 동시에 실행하지 마세요. 운영은 실제 PostgreSQL 서버와 분리된 worker를 사용합니다.

## 사용 흐름

1. 관리자 로그인 → 제작 건 생성 → 필요시 팀 설정에서 계정과 제작 건별 권한 부여.
2. 등록에서 결과물/소스 역할과 방송연도·제목·종류·담당·부조·키워드·설명을 입력.
3. 파일/폴더 업로드 또는 승인된 원본 NAS 조사 → 보존 계획의 검토 항목 확인 → 보존 확정.
4. NAS 복사·전체 체크섬 검증이 끝나면 자동 v1/vNext 공개. AV1/WebP 생성은 별도 작업으로 진행.
5. 카드 → 상세 → 원본 다운로드 / 연결 소스 / 버전 선택. 폴더는 ZIP64 준비 후 다운로드.
6. 수정 업로드에서 같은 상대경로는 새 버전에서 교체하고 미전송 경로는 승계합니다. 과거 버전은 유지됩니다.
7. 삭제창은 결과물+전용 연결 소스 삭제가 기본입니다. 공유 소스는 보존합니다. 범위를 확인한 뒤 실행하며, 물리 삭제가 시작되기 전까지만 취소할 수 있습니다.

UE는 Content 전체와 프로젝트 입력을 보존합니다. DDC·Intermediate·로그를 제외하고 Saved 설정·Binaries·필수 DLL은 검토합니다. 실행용 프로그램 생성이나 개별 UE 에셋의 의존성 자동 추출은 수행하지 않습니다.

## PostgreSQL + NAS 운영 구성

.env.example을 .env.local로 복사하여 실제 값을 입력하세요. 비밀 키는 각각 충분히 긴 무작위 값으로 생성합니다. DB 비밀번호/BOOTSTRAP_TOKEN/NEXTAUTH_SECRET은 커밋하지 않습니다.

- DATABASE_URL: 신규 PostgreSQL DB 연결. MongoDB 데이터 이전 절차는 없습니다.
- NEXTAUTH_URL: 사용자가 접속하는 서버 URL. 운영 접속은 HTTPS 리버스 프록시를 사용합니다.
- ARCHIVE_ROOT: 원본 보존용 NAS 공유.
- STAGING_ROOT: 재개 업로드·ZIP·인코딩 임시 공간.
- PREVIEW_ROOT: AV1/WebP 서비스 파일.
- SOURCE_ROOTS: 읽기 전용 제작 원본 경로의 JSON 배열. 서버 설정 후 관리자가 팀 설정에 등록해야 조사할 수 있습니다.
- RESTORE_ROOT: 선택 사항. 기존 원본/보존/임시 폴더와 분리된 새 작업 공간 복원 위치.
- FFMPEG_PATH / FFPROBE_PATH: 선택 사항. 미설정 시 설치된 번들 사용. AV1_ENCODER는 libsvtav1 또는 libaom-av1이며 미설정 시 사용 가능한 인코더를 선택합니다.
- AV1_CRF=32, AV1_MAX_HEIGHT=1080: 화면용 품질·최대 높이. 원본에는 적용하지 않습니다.

Windows 서비스 계정이 실제 UNC 공유를 읽고 쓸 수 있어야 합니다. 원본 NAS는 읽기 전용, 보존/임시/미리보기/복원은 각 역할에 필요한 권한을 부여합니다. 매핑 드라이브 문자는 서비스 세션에서 보이지 않을 수 있으므로 UNC 경로를 권장합니다. 루트끼리 겹치거나 링크로 외부 경로를 우회할 수 없습니다. NAS 경로를 public 디렉터리나 웹 정적 경로로 노출하지 않습니다.

PostgreSQL을 직접 준비하거나 제공된 compose.yaml을 사용할 수 있습니다. Compose 사용 시 .env.local에 POSTGRES_PASSWORD도 지정하고 DATABASE_URL의 비밀번호와 일치시킵니다. DB 데이터는 별도 named volume에 저장합니다.

~~~powershell
docker compose --env-file .env.local up -d postgres
npm run db:generate
npm run db:deploy
npm run build
npm start
~~~

별도 터미널/서비스에서:

~~~powershell
npm run worker
~~~

worker는 팀마다 MAINTENANCE_INTERVAL_MINUTES(기본 60분)마다 정리·무결성 점검을 예약합니다. 즉시 실행은 npm run maintenance 또는 팀 설정의 '지금 점검'입니다. 해시 점검량은 MAINTENANCE_HASH_BYTES(기본 2GiB/회)로 조절합니다.

웹과 worker는 같은 .env.local과 NAS 경로를 사용해야 합니다. 초기 DB 스키마 적용 후 /auth에서 팀을 생성합니다. worker 한 프로세스는 한 파일 작업씩 처리하며 긴 변환 작업은 큐에서 대기합니다. 여러 worker 확장은 실제 PostgreSQL/SMB 경쟁 시험 후 적용하세요. 정적 호스팅만으로는 이 프로젝트를 운영할 수 없습니다.

## 검증

~~~powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium   # 최초 1회
npm run test:e2e                  # 격리 개발 서버로 브라우저 시나리오 실행
npm run build
~~~

통합 시험은 .local의 독립 폴더와 PGlite에 가상 제작 자료를 만들고 시험 폴더만 제거합니다. 실제 NAS에는 쓰지 않습니다. AV1 시험은 FFmpeg/FFprobe를 실제 실행합니다.

2026-10-30: 단위 5개·통합 28개·E2E 5개 통과(Linux 개발 환경, Windows 재확인 필요). 2026-10-29: 단위 4개·통합 15개 통과, 격리 QA 서버의 로그인/업로드/원본 대조/검색/권한/Range HTTP 시험 통과. 실제 SMB·운영 PostgreSQL 동시성·10TB 성능·UE 에디터 열기·백업 복구 시험은 별도 수행해야 합니다. 설계된 78개 사례가 모두 통과했다는 뜻은 아닙니다.

## 문서와 구현

- [SDD v6.2](docs/SDD.ko.md)
- [TDD v6.2](docs/TDD.ko.md)
- [처음 합류했다면: 온보딩](ONBOARDING.md)
- [구현 범위·검증·운영 전 확인](docs/IMPLEMENTATION.ko.md)
- [운영 환경 수용 시험 체크리스트](docs/OPERATIONS-CHECKLIST.ko.md)
- [실제 PostgreSQL 스키마](prisma/schema.prisma)
- [신규 DB 스키마 및 보호 제약](prisma/migrations)

원본 파일은 불변 객체로 보존하고 DB가 경로·버전·관계를 관리합니다. NAS 객체명을 직접 수정하지 마세요. 다운로드는 인증된 API를 통하며 원래 파일명/폴더 구조를 제공합니다. DB와 NAS/manifest/삭제 원장을 함께 백업해야 합니다. 실제 제작 자료를 연결하기 전에 구현 문서의 운영 검증 항목을 확인하세요.
