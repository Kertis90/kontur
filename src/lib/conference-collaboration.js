// Shared by the room, history viewer and text export.
export function conferenceDate(value) {
  if (value instanceof Date) return value;
  const text = String(value || "");
  return new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text);
}

export const QUESTION_STATUS_LABELS = {
  open: "Ждёт ответа",
  answered: "Отвечен",
  dismissed: "Закрыт",
};

export function mergeConferenceMessages(current, incoming) {
  const messages = new Map(current.map((message) => [Number(message.id), message]));
  for (const message of incoming) {
    const previous = messages.get(Number(message.id));
    if (!previous || Number(message.revision || 1) >= Number(previous.revision || 1))
      messages.set(Number(message.id), message);
  }
  return [...messages.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function conferenceTranscriptEntry(message) {
  const date = conferenceDate(message.created_at);
  const time = Number.isNaN(date.getTime()) ? String(message.created_at) : date.toISOString();
  const type = message.message_type === "question"
    ? `Вопрос · ${QUESTION_STATUS_LABELS[message.question_status] || "Ждёт ответа"}`
    : "Сообщение";
  return `[${time}] ${message.sender_name} · ${type}\n${message.body}\n\n`;
}
