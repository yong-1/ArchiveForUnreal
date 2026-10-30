@echo off
rem ============================================================
rem  v6.1 보완 반영 후 PC에서 직접 해야 하는 작업
rem   1) 영화 앱 레거시 파일 삭제
rem   2) Prisma Client 재생성
rem   3) lint / typecheck / 단위 / 통합 테스트
rem   4) Playwright E2E (선택: --skip-e2e 로 건너뜀)
rem   5) migration 과 schema.prisma 차이 확인
rem      (SHADOW_DATABASE_URL 이 설정된 경우에만 실행)
rem
rem  사용법: 프로젝트 폴더에서  scripts\post-update-check.bat [--skip-e2e]
rem  실행 전: npm run dev:local 이 켜져 있다면 먼저 종료하세요.
rem ============================================================
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0.."
if not exist "package.json" (
  echo [오류] 프로젝트 폴더를 찾지 못했습니다. scripts 폴더 안에서 실행하세요.
  goto :fail
)

set "SKIP_E2E="
if /i "%~1"=="--skip-e2e" set "SKIP_E2E=1"

echo.
echo [1/5] 레거시 영화 앱 파일 삭제
for %%F in (
  components\AccountMenu.tsx components\BigLoader.tsx components\Billboard.tsx
  components\FavoriteButton.tsx components\InfoModal.tsx components\Input.tsx
  components\MobileMenu.tsx components\MovieCard.tsx components\MovieList.tsx
  components\Navbar.tsx components\NavbarItem.tsx components\PlayButton.tsx
  components\Profilebox.tsx components\SmallLoader.tsx
  hooks\useBillboard.ts hooks\useCurrentUser.ts hooks\useFavorites.ts
  hooks\useInfoModal.ts hooks\useMovie.ts hooks\useMovieList.ts
  lib\fetcher.ts lib\serverAuth.ts lib\prismadb.ts
) do (
  if exist "%%F" (
    del /q "%%F" && echo   삭제: %%F
  )
)
rem hooks 폴더는 비어 있을 때만 지운다(다른 파일이 있으면 그대로 둠).
if exist "hooks" rd "hooks" 2>nul && echo   삭제: hooks\
echo   git에 기록된 파일이므로 필요하면 git restore 로 되돌릴 수 있습니다.

echo.
echo [2/5] Prisma Client 재생성
call npm run db:generate || goto :fail

echo.
echo [3/5] 정적 검사와 테스트
call npm run lint || goto :fail
call npm run typecheck || goto :fail
call npm test || goto :fail
call npm run test:integration || goto :fail

echo.
if defined SKIP_E2E (
  echo [4/5] E2E 건너뜀 ^(--skip-e2e^)
) else (
  echo [4/5] Playwright E2E  - 포트 3100, 55460 을 사용합니다
  call npx playwright install chromium || goto :fail
  call npm run test:e2e || goto :fail
  echo   결과 보고서와 임시 데이터: .local\qa-e2e-*  ^(확인 후 지워도 됩니다^)
)

echo.
echo [5/5] migration 과 schema.prisma 차이 확인
if not defined SHADOW_DATABASE_URL (
  echo   건너뜀: 빈 PostgreSQL 시험 DB 주소를 SHADOW_DATABASE_URL 에 설정하면 실행합니다.
  echo   예^)  set SHADOW_DATABASE_URL=postgresql://archive_user:비밀번호@localhost:5432/archive_shadow
  echo         운영 DB 주소를 넣지 마세요. 이 DB는 검사 중 초기화됩니다.
  goto :done
)
call npx prisma migrate diff --from-migrations prisma\migrations --to-schema-datamodel prisma\schema.prisma --shadow-database-url "%SHADOW_DATABASE_URL%" --exit-code
if errorlevel 2 (
  echo [주의] migration 과 schema.prisma 사이에 차이가 있습니다. 위 SQL 을 확인하세요.
  goto :fail
)
if errorlevel 1 goto :fail
echo   차이 없음

:done
echo.
echo ============================================================
echo  모든 단계를 마쳤습니다.
echo  다음: git status 로 변경 목록을 확인한 뒤 브랜치를 만들고 커밋하세요.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo  [실패] 위 단계에서 멈췄습니다. 오류 메시지를 확인하세요.
echo ============================================================
pause
exit /b 1
