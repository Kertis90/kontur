import {StringDecoder} from 'node:string_decoder';

// Исправляет известную ошибку mysql #77856 только на внешнем завершителе триггера mysqldump.
// Данные таблиц, внутренние операторы и исходный зашифрованный архив остаются без изменений.
export async function* restoreSql(input) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', trigger = false;
  // Сохраняет строку целиком, убирая единственный лишний завершитель блока триггера.
  function line(value) {
    if (/^\/\*!50003 CREATE\*\/ .*\/\*!50003 TRIGGER\b/.test(value)) trigger = true;
    if (trigger && /\*\/;;\r?\n?$/.test(value)) {
      trigger = false;
      return value.replace(/;([ \t]*\*\/;;\r?\n?)$/, '$1');
    }
    return value;
  }
  for await (const chunk of input) {
    buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {yield line(buffer.slice(0, end + 1));buffer = buffer.slice(end + 1);}
  }
  buffer += decoder.end();
  if (buffer) yield line(buffer);
}
