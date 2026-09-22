import {z} from 'zod';
import {rows,one} from './db.js';
import {workspacePermissionSet} from './permissions.js';
import {positiveId,dateOnly,WorkError} from './work-common.js';
import {formulaValue} from './analytics-math.js';
export const timezoneSchema=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Неизвестный часовой пояс');
export const dashboardFilterSchema=z.object({projectId:positiveId.nullable().optional(),assigneeId:positiveId.nullable().optional(),stageId:positiveId.nullable().optional(),priority:z.enum(['','critical','high','medium','low']).optional(),query:z.string().max(200).optional(),from:dateOnly.optional(),to:dateOnly.optional(),timezone:timezoneSchema.optional()}).refine(v=>!v.from||!v.to||v.from<=v.to,'Начало периода позже окончания');
export const dashboardExtension={share_group_id:positiveId.nullable().default(null),is_template:z.coerce.boolean().default(false),revision:positiveId.optional()};
export async function dashboardGroups(user){return rows(`WITH RECURSIVE user_groups AS (
 SELECT g.id,g.parent_group_id,g.name,CAST(g.id AS CHAR(2000)) AS path FROM access_groups g JOIN access_group_members m ON m.group_id=g.id
 WHERE m.user_id=? AND g.workspace_id=? AND g.active=TRUE AND (m.expires_at IS NULL OR m.expires_at>CURRENT_TIMESTAMP)
 UNION ALL SELECT g.id,g.parent_group_id,g.name,CONCAT(u.path,',',g.id) FROM access_groups g JOIN user_groups u ON u.parent_group_id=g.id
 WHERE g.workspace_id=? AND g.active=TRUE AND FIND_IN_SET(g.id,u.path)=0
 ) SELECT DISTINCT id,name FROM user_groups`,[user.id,user.workspace_id,user.workspace_id]);}
export function canReadDashboard(user,dashboard,groupIds){return Number(dashboard.workspace_id)===Number(user.workspace_id)&&(Number(dashboard.owner_id)===Number(user.id)||(Boolean(dashboard.is_shared)&&(!dashboard.share_group_id||groupIds.has(Number(dashboard.share_group_id)))));}
export async function readableDashboard(user,id){const [dashboard,groups]=await Promise.all([one('SELECT * FROM dashboards WHERE id=? AND workspace_id=?',[positiveId.parse(id),user.workspace_id]),dashboardGroups(user)]);if(!dashboard||!canReadDashboard(user,dashboard,new Set(groups.map(g=>Number(g.id)))))throw new WorkError(404,'Дашборд недоступен');return dashboard;}
export async function validateDashboard(user,data){
 if(data.is_shared&&!(await workspacePermissionSet(user)).has('dashboard.share'))throw new WorkError(403,'Нет права делиться дашбордами');
 if(data.share_group_id&&!await one('SELECT id FROM access_groups WHERE id=? AND workspace_id=? AND active=TRUE',[data.share_group_id,user.workspace_id]))throw new WorkError(422,'Группа недоступна');
 if(!data.is_shared)data.share_group_id=null;
 for(const widget of data.widgets){if(widget.widget_type==='formula')try{formulaValue(widget.config.expression||'',{});}catch(e){throw new WorkError(422,e.message);}if(widget.config.projectId)positiveId.parse(widget.config.projectId);}
 return data;
}
