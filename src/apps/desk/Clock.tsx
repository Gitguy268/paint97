import { useEffect, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { formatClockDate, formatDigital, handAngles } from "../../lib/clock.ts";

/** Analogue face with a digital mode; both render from the same Date so they never disagree. */
export default function Clock() {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  const [digital, setDigital] = useState(false);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const a = handAngles(now);
  const time = formatDigital(now);
  return (
    <div className="clock-app">
      {digital ? (
        <div className="clock-digital"><p className="clock-time">{time}</p><p>{formatClockDate(now)}</p></div>
      ) : (
        <svg className="clock-face" viewBox="0 0 100 100" role="img" aria-label={t("clock.analog", { time })}>
          <circle cx="50" cy="50" r="47" fill="#fff" stroke="#000" strokeWidth="2" />
          {Array.from({ length: 12 }, (_, i) => <line key={i} stroke="#000" strokeWidth={i % 3 === 0 ? 2.5 : 1} x1="50" y1={i % 3 === 0 ? 5 : 8} x2="50" y2="12" transform={`rotate(${i * 30} 50 50)`} />)}
          <line stroke="#000" strokeWidth="5" x1="50" y1="50" x2="50" y2="28" transform={`rotate(${a.hour} 50 50)`} />
          <line stroke="#000" strokeWidth="3" x1="50" y1="50" x2="50" y2="16" transform={`rotate(${a.minute} 50 50)`} />
          <line stroke="#d00" strokeWidth="1.5" x1="50" y1="55" x2="50" y2="13" transform={`rotate(${a.second} 50 50)`} />
          <circle cx="50" cy="50" r="2.5" />
        </svg>
      )}
      <button aria-pressed={digital} onClick={() => setDigital((d) => !d)}>{t("clock.digital")}</button>
    </div>
  );
}
