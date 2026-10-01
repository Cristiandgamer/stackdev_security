export const CHILE_TIME_ZONE = 'America/Santiago'

const chileDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CHILE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const chileOffsetFormatter = new Intl.DateTimeFormat('en', {
  timeZone: CHILE_TIME_ZONE,
  timeZoneName: 'longOffset',
})

export function parseApiDateTime(value) {
  if (!value) return null
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  return new Date(timestamp)
}

function getChileParts(value) {
  const date = value instanceof Date ? value : parseApiDateTime(value)
  if (!date || Number.isNaN(date.getTime())) return null
  return Object.fromEntries(chileDateTimeFormatter.formatToParts(date).map(part => [part.type, part.value]))
}

function getChileOffsetMinutes(timestamp) {
  const value = chileOffsetFormatter
    .formatToParts(new Date(timestamp))
    .find(part => part.type === 'timeZoneName')?.value
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(value || '')
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

export function toChileISO(dateString, timeString) {
  if (!dateString || !timeString) return null
  const [year, month, day] = dateString.split('-').map(Number)
  const [hour, minute] = timeString.split(':').map(Number)
  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute)
  let utcTimestamp = localTimestamp

  for (let attempt = 0; attempt < 2; attempt++) {
    utcTimestamp = localTimestamp - getChileOffsetMinutes(utcTimestamp) * 60000
  }

  const resolved = new Date(utcTimestamp)
  const parts = getChileParts(resolved)
  if (
    !parts ||
    parts.year !== String(year).padStart(4, '0') ||
    parts.month !== String(month).padStart(2, '0') ||
    parts.day !== String(day).padStart(2, '0') ||
    parts.hour !== String(hour).padStart(2, '0') ||
    parts.minute !== String(minute).padStart(2, '0')
  ) return null

  return resolved.toISOString()
}

export function addDaysToDate(dateString, days) {
  if (!dateString) return ''
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function getChileDateString(value = new Date()) {
  const parts = getChileParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : ''
}

export function getChileHour(value = new Date()) {
  const parts = getChileParts(value)
  return parts ? Number(parts.hour) : 0
}

export function formatChileDateOnly(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return getChileDateString(value)
}

export function formatChileDate(value = new Date(), options = {}) {
  const date = value instanceof Date ? value : parseApiDateTime(value)
  if (!date || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-CL', {
    ...options,
    timeZone: CHILE_TIME_ZONE,
  })
}

export function getChileTimeString(value) {
  const parts = getChileParts(value)
  return parts ? `${parts.hour}:${parts.minute}` : ''
}

export function formatChileTime(value, options = {}) {
  const date = value instanceof Date ? value : parseApiDateTime(value)
  if (!date || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    hourCycle: 'h23',
    timeZone: CHILE_TIME_ZONE,
  })
}

export function formatChileDateTime(value, options = {}) {
  const date = value instanceof Date ? value : parseApiDateTime(value)
  if (!date || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    hourCycle: 'h23',
    timeZone: CHILE_TIME_ZONE,
  })
}

export function chileDateTimeLocalValue(value) {
  const parts = getChileParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : ''
}

export function chileDateTimeLocalToISO(value) {
  if (!value) return null
  const [date, time] = value.split('T')
  return toChileISO(date, time)
}