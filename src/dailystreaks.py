#!/usr/bin/env python3
"""Generate a lightweight GitHub daily streak SVG from commit events."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Dict, Iterable, List


# Keep base API endpoints in one place for maintainability.
GITHUB_API = "https://api.github.com"


@dataclass
class StreakStats:
    """Container for all summary values displayed in the card."""

    total_contributions: int
    current_streak: int
    longest_streak: int
    current_start: dt.date | None
    current_end: dt.date | None
    longest_start: dt.date | None
    longest_end: dt.date | None


def build_headers(token: str | None) -> Dict[str, str]:
    """Build consistent headers for GitHub API requests."""

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "DailyStreaks-Bot",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def parse_next_url(link_header: str | None) -> str | None:
    """Extract rel=next URL from GitHub Link header."""

    if not link_header:
        return None

    for chunk in link_header.split(","):
        part = chunk.strip()
        if 'rel="next"' not in part:
            continue

        start = part.find("<")
        end = part.find(">")
        if start != -1 and end != -1 and end > start:
            return part[start + 1 : end]

    return None


def page_oldest_timestamp(events: List[dict]) -> dt.datetime | None:
    """Return the oldest event timestamp in one page payload."""

    oldest: dt.datetime | None = None

    for event in events:
        created_at = event.get("created_at")
        if not created_at:
            continue
        candidate = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if oldest is None or candidate < oldest:
            oldest = candidate

    return oldest


def fetch_events(
    username: str,
    token: str | None,
    max_pages: int = 5,
    lookback_days: int = 120,
) -> List[dict]:
    """Fetch public events with safe pagination and early-stop heuristics."""

    # Keep loops bounded for speed and API friendliness.
    max_pages = max(1, min(max_pages, 10))
    lookback_days = max(1, lookback_days)

    # We only need a bounded history window for streak calculations.
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)

    events: List[dict] = []
    page_count = 0
    params = urllib.parse.urlencode({"per_page": 100})
    next_url: str | None = f"{GITHUB_API}/users/{username}/events/public?{params}"

    while next_url and page_count < max_pages:
        request = urllib.request.Request(next_url, headers=build_headers(token))

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
                link_header = response.headers.get("Link")
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode("utf-8", errors="ignore")

            # GitHub can return 422 when endpoint pagination depth is exceeded.
            if exc.code == 422 and "pagination is limited" in msg.lower():
                break

            # Provide actionable error for token/rate limit issues.
            if exc.code in (401, 403):
                raise RuntimeError(f"GitHub API auth/rate-limit error {exc.code}: {msg}") from exc

            raise RuntimeError(f"GitHub API error {exc.code}: {msg}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Network error: {exc}") from exc

        page_count += 1
        if not payload:
            break

        events.extend(payload)
        next_url = parse_next_url(link_header)

        # Stop early when this page is already older than lookback window.
        oldest_in_page = page_oldest_timestamp(payload)
        if oldest_in_page and oldest_in_page < cutoff:
            break

    return events


def aggregate_commit_days(events: Iterable[dict], timezone: dt.timezone) -> Dict[dt.date, int]:
    """Aggregate pushed commit counts by local calendar day."""

    contributions_by_day: Dict[dt.date, int] = {}

    for event in events:
        # Count only commits from push events (commit-log aligned behavior).
        if event.get("type") != "PushEvent":
            continue

        # Sum commits from payload, ignore empty pushes.
        commit_count = len(event.get("payload", {}).get("commits", []))
        if commit_count <= 0:
            continue

        # Convert UTC event timestamp into configured local date.
        created_at = event.get("created_at")
        if not created_at:
            continue

        timestamp = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        local_day = timestamp.astimezone(timezone).date()
        contributions_by_day[local_day] = contributions_by_day.get(local_day, 0) + commit_count

    return contributions_by_day


def compute_streaks(contributions_by_day: Dict[dt.date, int], today: dt.date) -> StreakStats:
    """Compute total, current streak, longest streak and date spans."""

    if not contributions_by_day:
        return StreakStats(0, 0, 0, None, None, None, None)

    sorted_days = sorted(contributions_by_day.keys())
    total_contributions = sum(contributions_by_day.values())

    longest_len = 1
    longest_start = sorted_days[0]
    longest_end = sorted_days[0]

    run_start = sorted_days[0]
    prev = sorted_days[0]

    for day in sorted_days[1:]:
        if (day - prev).days == 1:
            prev = day
            continue

        run_len = (prev - run_start).days + 1
        if run_len > longest_len:
            longest_len = run_len
            longest_start = run_start
            longest_end = prev

        run_start = day
        prev = day

    # Evaluate the final run after the loop.
    run_len = (prev - run_start).days + 1
    if run_len > longest_len:
        longest_len = run_len
        longest_start = run_start
        longest_end = prev

    # Current streak is active only if latest contribution is today or yesterday.
    latest = sorted_days[-1]
    if (today - latest).days > 1:
        current_len = 0
        current_start = None
        current_end = None
    else:
        current_end = latest
        current_start = latest
        while current_start - dt.timedelta(days=1) in contributions_by_day:
            current_start -= dt.timedelta(days=1)
        current_len = (current_end - current_start).days + 1

    return StreakStats(
        total_contributions=total_contributions,
        current_streak=current_len,
        longest_streak=longest_len,
        current_start=current_start,
        current_end=current_end,
        longest_start=longest_start,
        longest_end=longest_end,
    )


def day_fmt(day: dt.date) -> str:
    """Platform-safe day formatting (Linux/macOS/Windows)."""

    return day.strftime("%b %-d, %Y") if os.name != "nt" else day.strftime("%b %d, %Y")


def short_day_fmt(day: dt.date) -> str:
    """Platform-safe short day formatting used in same-year ranges."""

    return day.strftime("%b %-d") if os.name != "nt" else day.strftime("%b %d")


def format_range(start: dt.date | None, end: dt.date | None) -> str:
    """Render compact date ranges for card labels."""

    if not start or not end:
        return "No active streak"
    if start == end:
        return day_fmt(start)
    if start.year == end.year:
        return f"{short_day_fmt(start)} - {day_fmt(end)}"
    return f"{day_fmt(start)} - {day_fmt(end)}"


def render_svg(username: str, stats: StreakStats) -> str:
    """Create a compact SVG with three streak metrics."""

    return f"""<svg width=\"900\" height=\"220\" viewBox=\"0 0 900 220\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"GitHub streak stats\">
  <defs>
    <linearGradient id=\"bg\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\">
      <stop offset=\"0%\" stop-color=\"#0d1117\"/>
      <stop offset=\"100%\" stop-color=\"#161b22\"/>
    </linearGradient>
  </defs>
  <rect width=\"900\" height=\"220\" rx=\"18\" fill=\"url(#bg)\"/>
  <text x=\"450\" y=\"32\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"20\" fill=\"#58a6ff\">{username} • DailyStreaks</text>

  <line x1=\"300\" y1=\"55\" x2=\"300\" y2=\"195\" stroke=\"#30363d\"/>
  <line x1=\"600\" y1=\"55\" x2=\"600\" y2=\"195\" stroke=\"#30363d\"/>

  <text x=\"150\" y=\"98\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-weight=\"700\" font-size=\"52\" fill=\"#c9d1d9\">{stats.total_contributions}</text>
  <text x=\"150\" y=\"135\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"28\" fill=\"#8b949e\">Total Commits</text>

  <text x=\"450\" y=\"88\" text-anchor=\"middle\" font-family=\"Segoe UI Emoji, Segoe UI Symbol\" font-size=\"34\" fill=\"#ffa657\">🔥</text>
  <text x=\"450\" y=\"118\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-weight=\"700\" font-size=\"54\" fill=\"#ffa657\">{stats.current_streak}</text>
  <text x=\"450\" y=\"154\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"30\" fill=\"#ffa657\">Current Streak</text>
  <text x=\"450\" y=\"184\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"21\" fill=\"#8b949e\">{format_range(stats.current_start, stats.current_end)}</text>

  <text x=\"750\" y=\"98\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-weight=\"700\" font-size=\"52\" fill=\"#c9d1d9\">{stats.longest_streak}</text>
  <text x=\"750\" y=\"135\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"28\" fill=\"#8b949e\">Longest Streak</text>
  <text x=\"750\" y=\"170\" text-anchor=\"middle\" font-family=\"Segoe UI, Ubuntu, sans-serif\" font-size=\"21\" fill=\"#8b949e\">{format_range(stats.longest_start, stats.longest_end)}</text>
</svg>
"""


def parse_timezone(offset_hours: int) -> dt.timezone:
    """Create timezone from integer UTC offset for deterministic local-day math."""

    return dt.timezone(dt.timedelta(hours=offset_hours))


def main() -> int:
    """CLI entrypoint for local runs and GitHub Actions."""

    parser = argparse.ArgumentParser(description="Generate GitHub daily streak SVG")
    parser.add_argument("--username", required=True, help="GitHub username")
    parser.add_argument("--token", default=os.getenv("GITHUB_TOKEN"), help="GitHub API token")
    parser.add_argument("--timezone-offset", type=int, default=0, help="UTC offset in hours")
    parser.add_argument("--max-pages", type=int, default=5, help="Max API pages to fetch (1-10)")
    parser.add_argument("--lookback-days", type=int, default=120, help="History window in days")
    parser.add_argument("--output", default="assets/github-streak.svg", help="Output SVG path")
    parser.add_argument("--events-file", help="Optional local JSON file for offline testing")
    args = parser.parse_args()

    timezone = parse_timezone(args.timezone_offset)

    if args.events_file:
        with open(args.events_file, "r", encoding="utf-8") as fh:
            events = json.load(fh)
    else:
        events = fetch_events(
            username=args.username,
            token=args.token,
            max_pages=args.max_pages,
            lookback_days=args.lookback_days,
        )

    contributions_by_day = aggregate_commit_days(events, timezone)
    today = dt.datetime.now(timezone).date()
    stats = compute_streaks(contributions_by_day, today)

    svg = render_svg(args.username, stats)
    out_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(svg)

    print(
        json.dumps(
            {
                "username": args.username,
                "total_contributions": stats.total_contributions,
                "current_streak": stats.current_streak,
                "longest_streak": stats.longest_streak,
                "days_with_commits": len(contributions_by_day),
                "output": args.output,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
