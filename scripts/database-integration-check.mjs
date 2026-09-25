import {spawnSync} from 'node:child_process';
import {browserEnv} from './browser-env.mjs';

// Последовательно проверяет функции и восстановление на выбранном одноразовом стенде.
const scripts=['database-engine-check.mjs',...(browserEnv.DB_ENGINE==='postgres'?['postgres-sql-check.mjs']:[]),'plans-mysql-check.mjs','workspace-021-mysql-check.mjs','agent-debug-mysql-check.mjs','plan-assistant-mysql-check.mjs','jira-transfer-mysql-check.mjs',browserEnv.DB_ENGINE==='postgres'?'backup-postgres-check.mjs':'backup-mysql-check.mjs'];
for(const script of scripts) {
 const result=spawnSync(process.execPath,['--experimental-vm-modules',`scripts/${script}`],{stdio:'inherit',env:{...process.env,...browserEnv}});
 if(result.status!==0)process.exit(result.status||1);
}
