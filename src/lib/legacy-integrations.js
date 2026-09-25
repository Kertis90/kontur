import {rows} from './db.js';
import {databaseEngine} from './database-config.js';

// An installation where 021 was already repaired manually may have no archive.
// Do not query columns from the former 002 schema in the new notification table.
// Показывает владельцу сохранённые описания старых подключений без секретных настроек.
export async function legacyIntegrationSummaries(workspaceId,canManage){
 if(!canManage)return [];
 const tables=await rows(databaseEngine()==='postgres'?"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='integration_connections_legacy_002' AND table_type='BASE TABLE'":"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='integration_connections_legacy_002' AND TABLE_TYPE='BASE TABLE'");
 if(!tables.length)return [];
 // Config and error text can contain credentials. Only return display metadata.
 return rows('SELECT id,provider,name,enabled,last_sync_at,created_at FROM integration_connections_legacy_002 WHERE workspace_id=? ORDER BY provider,name',[workspaceId]);
}
