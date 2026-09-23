"use client";
import {useEffect, useState} from 'react';

// Обновляет часы отдельно от рабочих экранов, чтобы доска и конструктор не перерисовывались каждую секунду.
export default function WorkspaceClock() {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {const timer = setInterval(() => setClock(new Date()), 1000);return () => clearInterval(timer);}, []);
  return <time className="browser-clock" dateTime={clock.toISOString()} title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{clock.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>;
}
