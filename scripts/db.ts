import { config } from 'dotenv';
import { spawn } from 'node:child_process';
config({path:'.env.local',quiet:true});config({quiet:true});
const child=spawn(process.execPath,['node_modules/prisma/build/index.js',...process.argv.slice(2)],{stdio:'inherit',env:process.env,windowsHide:true});
child.on('exit',code=>process.exit(code??1));
child.on('error',()=>process.exit(1));

