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
from typing import Dict, Iterable, List, Tuple


# Keep the API endpoint in one place to simplify future extensions.
GITHUB_API = "https://api.github.com"


@dataclass
class StreakStats:
    """Container for summary metrics used by the SVG card."""

    total_contributions: int
    current_streak: int
    longest_streak: int
    current_start: dt.date | None
    current_end: dt.date | None
    longest_start: dt.date | None
    longest_end: dt.date | None


def fetch_events(username: str, token: str | None, max_pages: int = 5) -> List[dict]:
    """Fetch public user events and return combined JSON payload."""

    events: List[dict] = []

    # Iterate page by page to gather enough history for streak detection.
    for page in range(1, max_pages + 1):
        params = urllib.parse.urlencode({"per_page": 100, "page": page})
        url = f"{GITHUB_API}/users/{username}/events/public?{params}"

        # Build request headers. Auth raises API limits and improves reliability.
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "DailyStreaks-Bot",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        request = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"GitHub API error {exc.code}: {msg}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Network error: {exc}") from exc

        # Stop when there are no additional events.
        if not payload:
            break

        events.extend(payload)

    return events


def aggregate_commit_days(events: Iterable[dict], timezone: dt.timezone) -> Dict[dt.date, int]:
    """Map each UTC event timestamp to local date and count pushed commits."""

    contributions_by_day: Dict[dt.date, int] = {}

    for event in events:
        # We only count commit activity from push events to match "commit logs" intent.
        if event.get("type") != "PushEvent":
            continue

        # Count commits included in the push payload.
        commits = event.get("payload", {}).get("commits", [])
        commit_count = len(commits)
        if commit_count <= 0:
            continue

        # Convert event creation time into requested timezone date boundary.
        created_at = event.get("created_at")
        if not created_at:
            continue

        timestamp = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        local_day = timestamp.astimezone(timezone).date()
        contributions_by_day[local_day] = contributions_by_day.get(local_day, 0) + commit_count

    return contributions_by_day


def compute_streaks(contributions_by_day: Dict[dt.date, int], today: dt.date) -> StreakStats:
    """Compute current + longest streak values and associated date ranges."""

    if not contributions_by_day:
        return StreakStats(0, 0, 0, None, None, None, None)

    sorted_days = sorted(contributions_by_day.keys())
    total_contributions = sum(contributions_by_day.values())

    longest_len = 1
    longest_start = sorted_days[0]
    longest_end = sorted_days[0]

    run_start = sorted_days[0]
    prev = sorted_days[0]

    # Walk through all contribution days to identify contiguous runs.
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

    # Check the final run after loop completion.
    run_len = (prev - run_start).days + 1
    if run_len > longest_len:
        longest_len = run_len
        longest_start = run_start
        longest_end = prev

    # Determine whether current streak is still active (today or yesterday boundary).
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


def format_range(start: dt.date | None, end: dt.date | None) -> str:
    """Render compact date ranges for card labels."""

    if not start or not end:
        return "No active streak"
    if start == end:
        return start.strftime("%b %-d, %Y") if os.name != "nt" else start.strftime("%b %d, %Y")
    if start.year == end.year:
        return f"{start.strftime('%b %-d')} - {end.strftime('%b %-d, %Y')}" if os.name != "nt" else f"{start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}"
    return f"{start.strftime('%b %-d, %Y')} - {end.strftime('%b %-d, %Y')}" if os.name != "nt" else f"{start.strftime('%b %d, %Y')} - {end.strftime('%b %d, %Y')}"


def render_svg(username: str, stats: StreakStats) -> str:
    """Create a compact SVG with three streak metrics."""

    # Keep style minimal and self-contained for GitHub README compatibility.
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
    """CLI entrypoint used by local dev and GitHub Actions."""

    parser = argparse.ArgumentParser(description="Generate GitHub daily streak SVG")
    parser.add_argument("--username", required=True, help="GitHub username")
    parser.add_argument("--token", default=os.getenv("GITHUB_TOKEN"), help="GitHub API token")
    parser.add_argument("--timezone-offset", type=int, default=0, help="UTC offset in hours")
    parser.add_argument("--max-pages", type=int, default=5, help="Max API pages to fetch")
    parser.add_argument("--output", default="assets/github-streak.svg", help="Output SVG path")
    parser.add_argument("--events-file", help="Optional local JSON file for offline testing")
    args = parser.parse_args()

    timezone = parse_timezone(args.timezone_offset)

    # Allow fixture injection for deterministic tests and local demos.
    if args.events_file:
        with open(args.events_file, "r", encoding="utf-8") as fh:
            events = json.load(fh)
    else:
        events = fetch_events(args.username, args.token, args.max_pages)

    contributions_by_day = aggregate_commit_days(events, timezone)
    today = dt.datetime.now(timezone).date()
    stats = compute_streaks(contributions_by_day, today)

    svg = render_svg(args.username, stats)

    # Create output directory if it doesn't already exist.
    out_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(svg)

    # Emit quick summary for Action logs.
    print(
        json.dumps(
            {
                "username": args.username,
                "total_contributions": stats.total_contributions,
                "current_streak": stats.current_streak,
                "longest_streak": stats.longest_streak,
                "output": args.output,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
