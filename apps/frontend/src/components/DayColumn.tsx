import type { AgendaDay } from '@picalendar/shared';
import { EventCard } from './EventCard.js';

interface Props {
  day: AgendaDay;
  timezone: string;
  now: Date;
}

export function DayColumn({ day, timezone, now }: Props): JSX.Element {
  const date = new Date(`${day.date}T12:00:00Z`);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const dayOfMonth = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  return (
    <section
      className={`day-column card h-100 ${day.isToday ? 'day-column--today border-primary' : ''}`}
      aria-label={`${weekday} ${dayOfMonth}`}
    >
      <header className="card-header d-flex justify-content-between align-items-baseline">
        <span className="fw-bold">{day.isToday ? 'Today' : weekday}</span>
        <span className="text-body-secondary small">{dayOfMonth}</span>
      </header>

      <div className="card-body day-column__body">
        {day.occurrences.length === 0 ? (
          <p className="text-body-secondary small fst-italic mb-0">Nothing scheduled</p>
        ) : (
          day.occurrences.map((occurrence) => (
            <EventCard
              key={`${occurrence.id}-${day.date}`}
              occurrence={occurrence}
              dayKey={day.date}
              timezone={timezone}
              now={now}
            />
          ))
        )}
      </div>
    </section>
  );
}
