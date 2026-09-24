// Shared, browser-safe catalog. No credentials or server modules.
export const AGENT_EVENT_LABELS={'task.created':'Создана задача','task.updated':'Изменена задача','task.due_soon':'Приближается срок','comment.created':'Комментарий к задаче','quality.allure.imported':'Импортирован Allure'};
export const AGENT_ACTION_CATALOG=[
 {key:'create_task',name:'Создать задачу',permission:'task.create',scope:'tasks:write'},
 {key:'comment',name:'Добавить комментарий',permission:'comment.create',scope:'tasks:write'},
 {key:'update_task',name:'Изменить атрибуты задачи',permission:'task.edit',scope:'tasks:write'},
 {key:'move_task',name:'Перевести на этап',permission:'task.edit',scope:'tasks:write'},
 {key:'assign_task',name:'Назначить исполнителя',permission:'task.assign',scope:'tasks:write'},
 {key:'checklist_item',name:'Добавить пункт чек-листа',permission:'task.edit',scope:'tasks:write'},
 {key:'create_article',name:'Создать черновик статьи',permission:null,scope:'knowledge:write'},
 {key:'chat_message',name:'Сообщение в выбранный чат',permission:null,scope:'chat:write'},
];
export const AGENT_SOURCE_LABELS={task:'Задача',quality:'Прогон',article:'Статья',conference:'Встреча',recording:'Расшифровка',chat:'Чат',planning:'План проекта',objective:'Цель'};
export const AGENT_FIELD_LABELS={title:'Название',description:'Описание',priority:'Приоритет',stage_id:'Этап',assignee_id:'Исполнитель',due_date:'Срок',progress:'Прогресс',start_date:'Начало',estimate_minutes:'Оценка времени',spent_minutes:'Затрачено времени',story_points:'Story points',sprint_id:'Спринт',release_id:'Релиз'};
export const AGENT_METRICS={source_count:'Источников в контексте',task_count:'Задач в выборке',overdue_count:'Просроченных задач',critical_count:'Критических задач',failed_tests:'Ошибок тестов',flaky_tests:'Нестабильных тестов'};
export const AGENT_NODE_LABELS={analyze:'Анализ моделью',action:'Действие',approval:'Согласование сотрудника',condition:'Условие',filter:'Фильтр источников',template:'Собрать текст',stop:'Завершить сценарий',part:'Общая часть'};
export const AGENT_OPERATOR_LABELS={equals:'равно',not_equals:'не равно',greater:'больше',less:'меньше',contains:'содержит',not_empty:'заполнено',empty:'пусто'};
export function expandAgentConfig(c){return {...c,inputs:c.inputs||[],flow:{nodes:[],max_calls:8,positions:{},...c.flow},policy:{allowed_stage_ids:[],allowed_assignee_ids:[],article_space_ids:[],chat_channel_ids:[],editable_fields:['priority','due_date','progress'],min_confidence:0,require_citations:false,require_reasons:false,redact_emails:false,...c.policy},queue_limit:c.queue_limit??1,cooldown_minutes:c.cooldown_minutes??0,trigger:{...c.trigger,schedule:{mode:'interval',time:'09:00',timezone:'UTC',weekdays:[1,2,3,4,5],...c.trigger?.schedule},conditions:{mode:'all',rules:[],...c.trigger?.conditions}},sources:{planning:false,objectives:false,chat_channel_ids:[],recording_ids:[],...c.sources,tasks:{custom_fields:[],include_comments:false,include_checklist:false,assignee_ids:[],updated_days:0,query:'',...c.sources.tasks},semantic:{enabled:false,query:'',space_ids:[],limit:5,min_score:0.2,...c.sources.semantic},knowledge:{space_ids:[],query:'',limit:10,...c.sources.knowledge}}};}
