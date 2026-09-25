// Разрешает автоматическое применение только при отсутствующем или явно ложном флаге.
// Сравнение JSON напрямую с SQL FALSE в MySQL ошибочно считает JSON true равным нулю.
export const AUTOMATIC_REVIEW_FILTER = `
 (JSON_EXTRACT(source_meta_json,'$.review_required') IS NULL OR
  (JSON_TYPE(JSON_EXTRACT(source_meta_json,'$.review_required'))='BOOLEAN' AND JSON_UNQUOTE(JSON_EXTRACT(source_meta_json,'$.review_required'))='false'))
 AND (JSON_EXTRACT(source_meta_json,'$.dry_run') IS NULL OR
  (JSON_TYPE(JSON_EXTRACT(source_meta_json,'$.dry_run'))='BOOLEAN' AND JSON_UNQUOTE(JSON_EXTRACT(source_meta_json,'$.dry_run'))='false'))`;
