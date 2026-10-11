import type { Pattern, Tags } from './types';

export const UNGROUPED = 'ungrouped';

const DASHED_NAME = /^-(\d+)-(\d+)-\d+(?:\.\d+)?([+-])$/;
const POL_PM = /(?:^|[_\s-])([PM])45(?:pol)?(?=[_\s.-]|$)/i;
const POL_SIGN = /(?:^|[_\s])([+-])45(?=[_\s]|$)/;
const POL_COMMENT = /([+-])\s?45\s*(?:deg|pol)/i;
const TILT_NAME = /(?:^|[_\s-])(\d{1,2})(?:DT|T)(?=[_\s.-]|$)/i;
const TILT_COMMENT = [/Lever position\s+(\d+(?:\.\d+)?)\s*deg/i, /(\d+(?:\.\d+)?)\s*deg(?:rees?)?\s+tilt/i];
const PORT = [/Port\s*(\d+)/i, /-(P\d+)(?=[\s_]|$)/];
const ARRAY_NAME = /_([A-Za-z]{1,2}\d?)$/;
const ARRAY_COMMENT = /Array\s+(\S+)/i;

export function inferTags(p: Pattern): Tags {
  const base = p.fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const dashed = DASHED_NAME.exec(base);
  if (dashed) return { polarization: dashed[3] === '+' ? '+45' : '-45', tiltDeg: Number(dashed[2]), port: dashed[1] };

  const comment = p.comment ?? '';
  const tags: Tags = {};

  const pm = POL_PM.exec(base);
  const sign = POL_SIGN.exec(base);
  const pc = POL_COMMENT.exec(comment);
  if (pm) tags.polarization = pm[1].toUpperCase() === 'P' ? '+45' : '-45';
  else if (sign) tags.polarization = `${sign[1]}45`;
  else if (pc) tags.polarization = `${pc[1]}45`;

  const tn = TILT_NAME.exec(base);
  if (tn) tags.tiltDeg = Number(tn[1]);
  else if (p.electricalTiltDeg !== undefined) tags.tiltDeg = p.electricalTiltDeg;
  else {
    for (const re of TILT_COMMENT) {
      const m = re.exec(comment);
      if (m) {
        tags.tiltDeg = Number(m[1]);
        break;
      }
    }
  }

  for (const re of PORT) {
    const m = re.exec(base);
    if (m) {
      tags.port = m[1];
      break;
    }
  }

  const arr = ARRAY_NAME.exec(base) ?? ARRAY_COMMENT.exec(comment);
  if (arr) tags.array = arr[1];

  return tags;
}

export function groupKey(t: Tags): string {
  if (!t.polarization && t.tiltDeg === undefined) return UNGROUPED;
  return [t.polarization ?? '?', t.tiltDeg ?? '?', t.port ?? '', t.array ?? ''].join('|');
}

export function groupLabel(t: Tags): string {
  if (groupKey(t) === UNGROUPED) return 'Ungrouped';
  const parts = [t.polarization ?? '? pol', t.tiltDeg !== undefined ? `${t.tiltDeg}°T` : '? tilt'];
  if (t.port) parts.push(/^\d+$/.test(t.port) ? `Port ${t.port}` : t.port);
  if (t.array) parts.push(t.array);
  return parts.join(' · ');
}
