// 브라우저 E2E(TDD 10장). 실행할 때마다 격리된 QA 데이터 폴더·PGlite DB·포트로 개발 서버를 띄운다.
// 운영 DB/NAS에는 절대 연결하지 않는다. 사용법은 ONBOARDING.md의 'E2E' 절 참고.
import { defineConfig,devices } from '@playwright/test';
import path from 'node:path';
process.env.E2E_DATA_ROOT||=path.resolve('.local','qa-e2e-'+Date.now());
const port=Number(process.env.E2E_PORT||3100);
process.env.E2E_BASE_URL||=`http://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'e2e',
 fullyParallel:false,workers:1,retries:0,
 timeout:180_000,expect:{timeout:20_000},
 reporter:[['list'],['html',{open:'never',outputFolder:path.join(process.env.E2E_DATA_ROOT,'report')}]],
 outputDir:path.join(process.env.E2E_DATA_ROOT,'results'),
 globalSetup:'./e2e/global-setup.ts',
 use:{baseURL:process.env.E2E_BASE_URL,locale:'ko-KR',timezoneId:'Asia/Seoul',trace:'retain-on-failure',acceptDownloads:true,
  ...(process.env.PW_CHROMIUM_PATH?{launchOptions:{executablePath:process.env.PW_CHROMIUM_PATH}}:{})},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{
  command:'npm run dev:local',url:process.env.E2E_BASE_URL+'/auth',timeout:300_000,reuseExistingServer:false,stdout:'pipe',stderr:'pipe',
  env:{LOCAL_DATA_ROOT:process.env.E2E_DATA_ROOT,LOCAL_DB_PORT:String(Number(process.env.E2E_DB_PORT||55460)),PORT:String(port),NEXTAUTH_URL:process.env.E2E_BASE_URL,STORAGE_RESERVE_BYTES:'0',LOCAL_USE_CONFIGURED_STORAGE:'false'},
 },
});
