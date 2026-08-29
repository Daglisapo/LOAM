import { esc } from '../lib/ical.mjs';
import { readBlocks } from '../lib/store.mjs';

/* Outbound feed: the dates LOAM has closed directly. Airbnb and Booking.com
   import this URL, which is how a direct booking ends up blocking the OTAs.
   It deliberately contains only our own blocks — re-publishing dates that came
   *from* Airbnb back *to* Airbnb would be a sync loop. */

function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default async () => {
  const blocks = await readBlocks();
  const now = stamp(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LOAM Thessaloniki//Availability//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:LOAM — direct bookings',
  ];

  for (const b of blocks) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@loamskg.gr`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${b.start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${b.end.replace(/-/g, '')}`,
      `SUMMARY:${esc(b.note || 'Not available')}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="loam.ics"',
      'Cache-Control': 'public, max-age=60',
    },
  });
};

export const config = { path: '/api/calendar.ics' };
