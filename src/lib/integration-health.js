import {rows,transaction} from './db.js';
import {createNotification} from './events.js';
export async function updateIntegrationHealth(connectionId,success){
 return transaction(async c=>{
  const [[connection]]=await c.query('SELECT c.*,u.status AS user_status FROM integration_connections c JOIN users u ON u.id=c.created_by WHERE c.id=? FOR UPDATE',[connectionId]);if(!connection)return;
  await c.query('INSERT IGNORE INTO integration_health(connection_id) VALUES(?)',[connectionId]);
  const [[health]]=await c.query('SELECT *,last_alert_at IS NULL OR last_alert_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR) AS alert_due FROM integration_health WHERE connection_id=? FOR UPDATE',[connectionId]);
  if(connection.enabled&&connection.user_status==='active'&&((success&&health.degraded)||(!success&&health.alert_due))){
   await createNotification(connection.created_by,'integration.health',success?'Доставка интеграции восстановлена':'Ошибка доставки интеграции',`${connection.name}: ${success?'сервис снова принимает сообщения':'откройте журнал, проверьте реквизиты и доступность сервиса'}`,'integration',connectionId,'/?view=integrations',c);
   await c.query('UPDATE integration_health SET last_alert_at=CURRENT_TIMESTAMP WHERE connection_id=?',[connectionId]);
  }
  await c.query(`UPDATE integration_health SET degraded=?,${success?'last_success_at':'last_failure_at'}=CURRENT_TIMESTAMP WHERE connection_id=?`,[!success,connectionId]);
 });
}
export async function integrationHealthSummary(id){
 const [health,states]=await Promise.all([rows('SELECT degraded,last_alert_at,last_success_at,last_failure_at FROM integration_health WHERE connection_id=?',[id]),rows('SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM integration_deliveries WHERE connection_id=? AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 DAY) GROUP BY status',[id])]);return {health:health[0]||null,last_24_hours:states};
}
