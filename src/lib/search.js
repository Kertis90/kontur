const FIELD_MAP = {
  project: { sql: "p.key_code", type: "string" },
  projectId: { sql: "p.id", type: "number" },
  status: { sql: "ws.code", type: "string" },
  statusCategory: { sql: "ws.category", type: "string" },
  assignee: { sql: "u.email", type: "string" },
  assigneeId: { sql: "t.assignee_id", type: "number" },
  reporterId: { sql: "t.reporter_id", type: "number" },
  priority: { sql: "t.priority", type: "string" },
  type: { sql: "it.code", type: "string" },
  sprint: { sql: "s.name", type: "string" },
  sprintId: { sql: "t.sprint_id", type: "number" },
  release: { sql: "r.name", type: "string" },
  dueDate: { sql: "t.due_date", type: "date" },
  created: { sql: "t.created_at", type: "date" },
  updated: { sql: "t.updated_at", type: "date" },
  storyPoints: { sql: "t.story_points", type: "number" },
  resolution: { sql: "t.resolution", type: "string" },
};

const ORDER_FIELDS = { priority: "FIELD(t.priority, 'critical','high','medium','low')", dueDate: "t.due_date", created: "t.created_at", updated: "t.updated_at", rank: "t.rank_value", key: "t.task_number" };

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  return trimmed;
}

function splitList(value) {
  return value.replace(/^\(|\)$/g, "").split(",").map(unquote).filter(Boolean);
}

function dynamicValue(value, user) {
  const normalized = value.trim();
  if (/^currentUser\(\)$/i.test(normalized)) return user.email;
  if (/^startOfDay\(\)$/i.test(normalized)) return new Date().toISOString().slice(0, 10);
  if (/^endOfWeek\(\)$/i.test(normalized)) { const date = new Date(); date.setDate(date.getDate() + ((7 - date.getDay()) % 7)); return date.toISOString().slice(0, 10); }
  return unquote(value);
}

export function compileQuery(queryText, user) {
  let source = String(queryText || "").trim();
  let orderSql = "t.updated_at DESC";
  const orderMatch = source.match(/\s+ORDER\s+BY\s+([A-Za-z]+)(?:\s+(ASC|DESC))?\s*$/i);
  if (orderMatch) {
    const field = ORDER_FIELDS[orderMatch[1]];
    if (!field) throw new Error(`Поле сортировки «${orderMatch[1]}» не поддерживается`);
    orderSql = `${field} ${(orderMatch[2] || "ASC").toUpperCase()}`;
    source = source.slice(0, orderMatch.index).trim();
  }
  if (!source) return { where: "1=1", params: [], orderSql };

  const pieces = source.split(/\s+(AND|OR)\s+/i);
  const where = [];
  const params = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const clause = pieces[index].trim();
    const bool = index ? pieces[index - 1].toUpperCase() : null;
    const match = clause.match(/^([A-Za-z][A-Za-z0-9]*)\s*(=|!=|>=|<=|>|<|IN|NOT\s+IN|IS\s+EMPTY|IS\s+NOT\s+EMPTY|~)\s*(.*)$/i);
    if (!match) throw new Error(`Не удалось разобрать условие: ${clause}`);
    const [, fieldName, rawOperator, rawValue] = match;
    const field = FIELD_MAP[fieldName];
    if (!field) throw new Error(`Поле «${fieldName}» не поддерживается`);
    const operator = rawOperator.toUpperCase().replace(/\s+/g, " ");
    let sql;
    if (operator === "IS EMPTY") sql = `${field.sql} IS NULL`;
    else if (operator === "IS NOT EMPTY") sql = `${field.sql} IS NOT NULL`;
    else if (operator === "IN" || operator === "NOT IN") {
      const values = splitList(rawValue).map((value) => dynamicValue(value, user));
      if (!values.length) throw new Error("Список значений не может быть пустым");
      sql = `${field.sql} ${operator} (${values.map(() => "?").join(",")})`; params.push(...values);
    } else if (operator === "~") {
      sql = `(${field.sql} LIKE ?)`; params.push(`%${dynamicValue(rawValue, user)}%`);
    } else {
      sql = `${field.sql} ${operator} ?`; params.push(dynamicValue(rawValue, user));
    }
    if (bool) where.push(bool);
    where.push(`(${sql})`);
  }
  return { where: where.join(" "), params, orderSql };
}

export function taskSearchSql(where, orderSql) {
  return `SELECT t.*, p.key_code, p.name AS project_name, ws.name AS stage_name, ws.code AS stage_code, ws.color AS stage_color, ws.category AS status_category, ws.is_done,
                 u.display_name AS assignee_name, u.email AS assignee_email, u.avatar_color AS assignee_color,
                 it.name AS issue_type_name, it.code AS issue_type_code, it.icon AS issue_type_icon, it.color AS issue_type_color,
                 s.name AS sprint_name, s.status AS sprint_status, r.name AS release_name
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          JOIN workflow_stages ws ON ws.id = t.stage_id
          LEFT JOIN users u ON u.id = t.assignee_id
          LEFT JOIN issue_types it ON it.id = t.issue_type_id
          LEFT JOIN sprints s ON s.id = t.sprint_id
          LEFT JOIN releases r ON r.id = t.release_id
          WHERE p.workspace_id = ? AND (${where})
          ORDER BY ${orderSql}
          LIMIT ? OFFSET ?`;
}
