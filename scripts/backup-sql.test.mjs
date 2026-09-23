import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {restoreSql} from './backup-sql.mjs';

// Собирает поток по небольшим порциям, включая границы многобайтовых русских символов.
async function normalized(value) {
  const bytes = Buffer.from(value), chunks = [];
  for (let index = 0; index < bytes.length; index += 3) chunks.push(bytes.subarray(index, index + 3));
  return (await Array.fromAsync(restoreSql(Readable.from(chunks)))).join('');
}

test('восстановление исправляет завершающую точку с запятой только в блоке триггера mysqldump', async () => {
  const input = "INSERT INTO notes VALUES ('Текст ; */;;');\nDELIMITER ;;\n/*!50003 CREATE*/ /*!50017 DEFINER=`user`@`%`*/ /*!50003 TRIGGER `t` AFTER INSERT ON `tasks` FOR EACH ROW INSERT INTO notes VALUES ('Привет'); */;;\nDELIMITER ;\n";
  assert.equal(await normalized(input), input.replace("('Привет'); */;;", "('Привет') */;;"));
});

test('многострочный триггер сохраняет внутренние операторы и переносы строк', async () => {
  const input = 'DELIMITER ;;\r\n/*!50003 CREATE*/ /*!50017 DEFINER=`user`@`%`*/ /*!50003 TRIGGER `t` AFTER INSERT ON `tasks` FOR EACH ROW BEGIN\r\nSET @a=1;\r\nSET @b=2;\r\nEND; */;;\r\nDELIMITER ;\r\n';
  assert.equal(await normalized(input), input.replace('END; */;;', 'END */;;'));
});

test('обычная выгрузка и триггер без лишнего завершителя остаются побайтово прежними', async () => {
  const input = "-- Русский текст\nINSERT INTO notes VALUES ('END; */;;');\n/*!50003 CREATE*/ /*!50017 DEFINER=`u`@`%`*/ /*!50003 TRIGGER `t` BEFORE INSERT ON `tasks` FOR EACH ROW SET NEW.id=1 */;;\n";
  assert.equal(await normalized(input), input);
});
