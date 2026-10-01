from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
CHILE_TIME_ZONE = ZoneInfo("America/Santiago")


def utc_now_naive() -> datetime:
    """Return UTC now without tzinfo for MySQL DATETIME columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_utc_naive(value: datetime) -> datetime:
    """Normalize an API datetime to the UTC-naive convention used in MySQL."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def utc_naive_to_chile(value: datetime) -> datetime:
    """Interpret a database datetime as UTC and convert it to Chile time."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    return value.astimezone(CHILE_TIME_ZONE)


def chile_today() -> date:
    return datetime.now(CHILE_TIME_ZONE).date()


def chile_date_utc_range(day: date) -> tuple[datetime, datetime]:
    """Return the UTC-naive start and exclusive end of a Chile calendar day."""
    next_day = day + timedelta(days=1)
    start = datetime.combine(day, time.min, CHILE_TIME_ZONE).astimezone(UTC)
    end = datetime.combine(next_day, time.min, CHILE_TIME_ZONE).astimezone(UTC)
    return start.replace(tzinfo=None), end.replace(tzinfo=None)