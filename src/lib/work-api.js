import {operationsApi} from './work-operations.js';
import {agentsApi} from './work-agents.js';
import {allureApi} from './work-allure.js';
import {browserPushApi} from './browser-push.js';
import {jiraImportApi} from './work-jira-import.js';
import {semanticApi} from './work-semantic.js';
import {qualityApi} from './work-quality.js';
import {objectivesApi} from './work-objectives.js';
import {externalSyncApi} from './external-sync.js';
import {integrationsApi} from './work-integrations.js';
import {taskAiApi} from './task-ai.js';
import {aiUsageApi} from './ai-budget.js';
import {conferenceCaptionsApi} from './conference-captions.js';
import {conferenceToolsApi} from './conference-tools.js';
import {levelingApi} from './work-leveling.js';
import {analyticsApi} from './work-analytics.js';
import {viewsApi} from './work-views.js';
import { slaApi } from './work-sla.js';
import { securityApi } from './work-security.js';
import { directoryApi } from './work-directory.js';
import { rows } from './db.js';
import { WorkError,reply,workspaceFor,projectFor } from './work-common.js';
import { automationApi } from './work-automation.js';
import { planningApi } from './work-planning.js';
import { accessApi } from './work-access.js';
import { workAiApi } from './work-ai.js';
import { recordingWorkApi } from './work-recordings.js';
import { knowledgeWorkApi } from './work-knowledge.js';
import { importWorkApi } from './work-import.js';
import { developmentApi } from './work-development.js';
import { personalApi } from './work-personal.js';
import { recordingConferenceAccess } from './recordings.js';
export async function handleWorkApi(request,path,user){
  if(path[0]==='agents')return agentsApi(request,path,user);
  if(path[0]==='allure')return allureApi(request,path,user);
  if(path[0]==='push')return browserPushApi(request,path,user);
  if(path[0]==='operations')return operationsApi(request,path,user);
  if(path[0]==='jira-imports')return jiraImportApi(request,path,user);
  if(path[0]==='semantic')return semanticApi(request,path,user);
  if(path[0]==='quality')return qualityApi(request,path,user);
  if(path[0]==='objectives')return objectivesApi(request,path,user);
  if(path[0]==='sync-meetings'&&request.method==='GET'){
    await workspaceFor(user,'calendar.connect');
    const all=await rows("SELECT c.id,c.project_id,c.title FROM conferences c WHERE c.workspace_id=? AND c.status='scheduled' AND (c.created_by=? OR EXISTS(SELECT 1 FROM conference_participants cp WHERE cp.conference_id=c.id AND cp.user_id=?)) ORDER BY c.scheduled_start LIMIT 500",[user.workspace_id,user.id,user.id]);
    const visible=[];for(const meeting of all){try{await projectFor(user,meeting.project_id);await recordingConferenceAccess(user,meeting.id);visible.push(meeting);}catch(e){if(![403,404].includes(e.status))throw e;}}return reply(visible);
  }
  if(path[0]==='sync')return externalSyncApi(request,path,user);
  if(path[0]==='integrations')return integrationsApi(request,path,user);
  if(path[0]==='task-ai')return taskAiApi(request,user);
  if(path[0]==='ai-usage')return aiUsageApi(request,user);
  if(path[0]==='conference-captions')return conferenceCaptionsApi(request,path,user);
  if(path[0]==='conference-tools')return conferenceToolsApi(request,path,user);
  if(path[0]==='leveling')return levelingApi(request,user);
  if(path[0]==='analytics')return analyticsApi(request,path,user);
  if(['views','task-changes','undo'].includes(path[0]))return viewsApi(request,path,user);
  if(path[0]==='sla')return slaApi(request,path,user);
  if(path[0]==='security')return securityApi(request,path,user);
  if(path[0]==='directory')return directoryApi(request,path,user);
  if(path[0]==='automations')return automationApi(request,path,user);
  if(['approvals','approval-gates','capacity','portfolio'].includes(path[0]))return planningApi(request,path,user);
  if(['field-access','access-requests','access-directory','access-explain'].includes(path[0]))return accessApi(request,path,user);
  if(['ai-search','meeting-actions'].includes(path[0]))return workAiApi(request,path,user);
  if(path[0]==='recordings')return recordingWorkApi(request,path,user);
  if(path[0]==='knowledge')return knowledgeWorkApi(request,path,user);
  if(path[0]==='imports'&&request.method==='POST')return importWorkApi(request,path,user);
  if(path[0]==='development')return developmentApi(request,path,user);
  if(['preferences','bulk','offline'].includes(path[0]))return personalApi(request,path,user);
  if(path[0]==='meetings'&&request.method==='GET'){
    const all=await rows('SELECT id,project_id,title,scheduled_start FROM conferences WHERE workspace_id=? ORDER BY scheduled_start DESC LIMIT 500',[user.workspace_id]);
    const visible=[];for(const conference of all){try{await recordingConferenceAccess(user,conference.id,'conference.recording.view');conference.recordings=await rows("SELECT id,duration_seconds,created_at,transcript_status FROM conference_recordings WHERE conference_id=? AND deleted_at IS NULL AND (retained_until IS NULL OR retained_until>CURRENT_TIMESTAMP) AND status='completed' ORDER BY id DESC",[conference.id]);visible.push(conference);}catch(e){if(![403,404].includes(e.status))throw e;}}
    return reply(visible);
  }
  throw new WorkError(404,'Рабочий инструмент не найден');
}
