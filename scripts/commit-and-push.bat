@echo off
rem ============================================================
rem  아카이브 구현을 커밋하고 https://github.com/yong-1/ArchiveForUnreal.git 로 푸시
rem   - 기존 origin(원본 NextFlix 저장소)은 upstream 으로 이름을 바꿔 보관
rem   - 얕은 클론이면 upstream 기록을 받아 와서(--unshallow) 푸시 가능하게 함
rem   - 레거시 영화 앱 파일 삭제를 함께 반영
rem   - 비밀 파일(.env, .env.local, .local, dev-secrets)이 섞이면 중단
rem  사용법: 프로젝트 폴더에서  scripts\commit-and-push.bat
rem  권장: 먼저 scripts\post-update-check.bat 로 검사를 통과시킨 뒤 실행
rem ============================================================
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
set "TARGET=https://github.com/yong-1/ArchiveForUnreal.git"

where git >nul 2>&1 || (echo [오류] git 을 찾을 수 없습니다. & goto :fail)
git rev-parse --is-inside-work-tree >nul 2>&1 || (echo [오류] git 저장소가 아닙니다. & goto :fail)
for /f "delims=" %%e in ('git config user.email') do set "GIT_EMAIL=%%e"
if not defined GIT_EMAIL (
  echo [오류] git 사용자 정보가 없습니다. 아래를 먼저 실행하세요.
  echo   git config --global user.name "이름"
  echo   git config --global user.email "메일"
  goto :fail
)

for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
if /i not "!BRANCH!"=="main" (
  echo [오류] 현재 브랜치가 main 이 아닙니다: !BRANCH!
  goto :fail
)

echo.
echo [1/6] 원격 저장소 설정
set "ORIGIN="
for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set "ORIGIN=%%u"
if defined ORIGIN if /i not "!ORIGIN!"=="%TARGET%" (
  git remote get-url upstream >nul 2>&1 && (echo [오류] upstream 원격이 이미 있습니다. 원격 설정을 직접 확인하세요. & goto :fail)
  git remote rename origin upstream || goto :fail
  echo   기존 origin 을 upstream 으로 변경: !ORIGIN!
  set "ORIGIN="
)
if not defined ORIGIN (
  git remote add origin %TARGET% || goto :fail
  echo   origin 추가: %TARGET%
)
git remote -v

echo.
echo [2/6] 얕은 클론 확인
if exist ".git\shallow" (
  git remote get-url upstream >nul 2>&1 || (echo [오류] 얕은 클론인데 upstream 원격이 없어 기록을 받을 수 없습니다. & goto :fail)
  echo   upstream 의 전체 기록을 받아 옵니다.
  git fetch --unshallow upstream || goto :fail
) else (
  echo   전체 기록이 있습니다.
)

echo.
echo [3/6] 레거시 영화 앱 파일 삭제
for %%F in (
  components\AccountMenu.tsx components\BigLoader.tsx components\Billboard.tsx
  components\FavoriteButton.tsx components\InfoModal.tsx components\Input.tsx
  components\MobileMenu.tsx components\MovieCard.tsx components\MovieList.tsx
  components\Navbar.tsx components\NavbarItem.tsx components\PlayButton.tsx
  components\Profilebox.tsx components\SmallLoader.tsx
  hooks\useBillboard.ts hooks\useCurrentUser.ts hooks\useFavorites.ts
  hooks\useInfoModal.ts hooks\useMovie.ts hooks\useMovieList.ts
  lib\fetcher.ts lib\serverAuth.ts lib\prismadb.ts
) do if exist "%%F" del /q "%%F"
if exist "hooks" rd "hooks" 2>nul

echo.
echo [4/6] 변경 스테이징과 비밀 파일 검사
git add -A || goto :fail
git diff --cached --name-only | findstr /r /i /c:"^\.env$" /c:"^\.env\.local$" /c:"^\.local/" /c:"dev-secrets" /c:"\.pem$" >nul
if not errorlevel 1 (
  echo [중단] 비밀 파일이 커밋 대상에 포함되어 있습니다.
  git diff --cached --name-only | findstr /r /i /c:"^\.env$" /c:"^\.env\.local$" /c:"^\.local/" /c:"dev-secrets" /c:"\.pem$"
  git reset -q
  goto :fail
)
git diff --cached --shortstat
echo.
choice /c YN /m "위 변경을 커밋하고 %TARGET% 로 푸시할까요"
if errorlevel 2 (
  git reset -q
  echo   취소했습니다. 파일은 그대로이며 스테이징만 해제했습니다.
  goto :end
)

echo.
echo [5/6] 커밋
set "MSG=%TEMP%\archive-commit-msg.txt"
> "%MSG%" echo Production archive: PostgreSQL/NAS 구현과 SDD v6.1 대조 보완
>>"%MSG%" echo.
>>"%MSG%" echo - PostgreSQL+JSONB 스키마, NAS 불변 객체 보존, 재개 업로드, 자동 버전과 경로 기준 교체/승계
>>"%MSG%" echo - 기본 동시 삭제와 공유 소스 보존, UE 캐시 제외 정책, AV1/WebP 미리보기
>>"%MSG%" echo - v6.1 보완: 파일 signature 검사, 상태 CHECK, 실사용 확인 연결과 역탐색, 버전 설명/메모 이력
>>"%MSG%" echo - 제작 건/Unreal 상세 화면, manifest 대조, 정리·무결성 점검 작업, 작업 진행 이력
>>"%MSG%" echo - B0 통합 테스트, Playwright E2E, 운영 체크리스트, ONBOARDING.md
>>"%MSG%" echo - 사용하지 않는 영화 앱 컴포넌트와 훅 삭제
>>"%MSG%" echo.
>>"%MSG%" echo Co-Authored-By: Claude Opus 5.5 ^<noreply@anthropic.com^>
>>"%MSG%" echo Claude-Session: https://claude.ai/code/session_01QFzXZtCbcTz44iZk4Ws8V5
git commit -q -F "%MSG%" || goto :fail
del "%MSG%" >nul 2>&1
git log --oneline -1

echo.
echo [6/6] 푸시
git push -u origin main || goto :fail
git status -sb

:end
echo.
echo ============================================================
echo  완료했습니다.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo  [실패] 위 단계에서 멈췄습니다. 오류 메시지를 확인하세요.
echo  이미 만든 커밋은 로컬에 남아 있으므로 원인 해결 후 git push -u origin main 으로 다시 올릴 수 있습니다.
echo ============================================================
pause
exit /b 1
