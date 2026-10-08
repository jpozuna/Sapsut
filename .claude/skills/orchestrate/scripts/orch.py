#!/usr/bin/env python3
"""Board, scope, check and accept helpers for the orchestrate skill.

Run from anywhere inside the repo:

  orch.py validate                 check the open board and its tickets
  orch.py resume                   one-screen summary for a fresh manager session
  orch.py items T-NN               list a ticket's Done-when items, numbered
  orch.py status T-NN STATUS       set Status in the ticket file and BOARD.md
  orch.py scope [T-NN ...]         map changed paths to owning tickets
  orch.py check [--all] [--repeat N] [T-NN ...]
                                   run the repo checks, one line per check
  orch.py accept T-NN --met 1,2,3 [--unmet REASON] [--trailer LINE]
                                   tick, mark done, format and commit one ticket

Output is short on purpose: the manager reads it instead of raw logs. Full
check logs go to tickets/reviews/logs/.
"""
import argparse
import contextlib
import io
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

STATUSES = ("todo", "in-progress", "blocked", "review", "done")
REQUIRED_SECTIONS = ("Goal", "Done when", "Owns", "Reads", "Depends on", "Specialists", "Handoff")
ID_RE = re.compile(r"\b([TM]-\d+)\b")
PRETTIER_GLOB = "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"


def root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("not inside a git repository")
    return Path(out.stdout.strip())


ROOT = root()
TICKETS = ROOT / "tickets"
BOARD = TICKETS / "BOARD.md"
LOGS = TICKETS / "reviews" / "logs"


# ---------- parsing ----------

class Ticket:
    def __init__(self, path: Path):
        self.path = path
        self.text = path.read_text()
        first = self.text.splitlines()[0] if self.text else ""
        m = re.match(r"#\s*([TM]-\d+):\s*(.*)", first)
        self.id = m.group(1) if m else path.name.split("-", 2)[0] + "-" + path.name.split("-", 2)[1]
        self.title = m.group(2).strip() if m else ""
        sm = re.search(r"^Status:\s*([\w-]+)", self.text, re.M)
        self.status = sm.group(1) if sm else ""
        self.sections = {}
        cur = None
        for line in self.text.splitlines():
            h = re.match(r"^##\s+(.+?)\s*$", line)
            if h:
                cur = h.group(1)
                self.sections[cur] = []
            elif cur:
                self.sections[cur].append(line)

    def section(self, name):
        for k, v in self.sections.items():
            if k == name or k.startswith(name):
                return v
        return None

    def bullets(self, name):
        out = []
        for line in self.section(name) or []:
            m = re.match(r"^\s*-\s+(.*)", line)
            if m:
                out.append(m.group(1).strip())
        return out

    @property
    def owns(self):
        paths = []
        for b in self.bullets("Owns"):
            p = b.split(" # ")[0].split(" (")[0].strip().strip("`").strip()
            if p and p.lower() != "none":
                paths.append(p.rstrip("/") if p != "/" else p)
        return paths

    @property
    def deps(self):
        ids = []
        for b in self.bullets("Depends on"):
            head = b.split("(")[0]
            ids += ID_RE.findall(head)
        return ids

    def done_items(self):
        """[(line_index, checked, first_line_text)] for Done-when checkboxes."""
        lines = self.text.splitlines()
        items, in_sec = [], False
        for i, line in enumerate(lines):
            if re.match(r"^##\s+", line):
                in_sec = line.strip().startswith("## Done when")
                continue
            if in_sec:
                m = re.match(r"^- \[([ xX])\]\s*(.*)", line)
                if m:
                    items.append((i, m.group(1) != " ", m.group(2)))
        return items


def ticket_files():
    return {t.id: t for t in (Ticket(p) for p in sorted(TICKETS.glob("[TM]-*.md")))}


def open_board():
    """(title, header, rows) for the first table in BOARD.md. rows: list of dicts."""
    if not BOARD.exists():
        return None, [], []
    title, header, rows = "", [], []
    for line in BOARD.read_text().splitlines():
        if line.startswith("# ") and not title:
            title = re.sub(r"^Board:\s*", "", line[2:].strip())
        if line.startswith("## Previous board") or (rows and not line.startswith("|")):
            if rows:
                break
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not header:
                header = cells
            elif set(line.replace("|", "").strip()) <= set("-: "):
                continue
            else:
                rows.append(dict(zip(header, cells)))
    return title, header, rows


def find_ticket(tid):
    t = ticket_files().get(tid)
    if not t:
        sys.exit(f"no ticket file tickets/{tid}-*.md")
    return t


def covers(owner: str, path: str) -> bool:
    return path == owner or path.startswith(owner.rstrip("/") + "/")


def overlap(a: str, b: str) -> bool:
    return covers(a, b) or covers(b, a)


def changed_paths():
    """Changed, staged and untracked paths (renames give both sides)."""
    out = subprocess.run(["git", "status", "--porcelain=v1", "-z", "-uall"],
                         cwd=ROOT, capture_output=True, text=True).stdout
    parts, paths, i = out.split("\0"), [], 0
    while i < len(parts):
        entry = parts[i]
        if len(entry) < 4:
            i += 1
            continue
        xy, p = entry[:2], entry[3:]
        paths.append(p)
        if "R" in xy or "C" in xy:
            i += 1
            if i < len(parts) and parts[i]:
                paths.append(parts[i])
        i += 1
    return sorted(set(paths))


# ---------- commands ----------

def ancestors(tid, tickets, seen=None):
    seen = set() if seen is None else seen
    t = tickets.get(tid)
    for d in (t.deps if t else []):
        if d not in seen:
            seen.add(d)
            ancestors(d, tickets, seen)
    return seen


def cmd_validate(_args):
    title, header, rows = open_board()
    if not rows:
        sys.exit("FAIL no board table in tickets/BOARD.md")
    tickets = ticket_files()
    errors, warns = [], []
    board_ids = [r.get("ID", "") for r in rows]
    for col in ("ID", "Status", "Depends on", "Parallel group"):
        if col not in header:
            errors.append(f"board: missing column '{col}'")
    groups = {r.get("ID"): r.get("Parallel group", "") for r in rows}
    per_group = {}
    for r in rows:
        tid = r.get("ID", "")
        t = tickets.get(tid)
        if tid.startswith("M-") and not t:
            continue  # manager task, board row only
        if not t:
            errors.append(f"{tid}: no ticket file")
            continue
        missing = [s for s in REQUIRED_SECTIONS if t.section(s) is None]
        if missing:
            errors.append(f"{tid}: missing sections {', '.join(missing)}")
        if t.status not in STATUSES:
            errors.append(f"{tid}: bad Status '{t.status}'")
        if r.get("Status") and r.get("Status") != t.status:
            warns.append(f"{tid}: board says {r.get('Status')}, ticket says {t.status} (ticket wins)")
        if not "".join(t.section("Goal") or []).strip():
            errors.append(f"{tid}: empty Goal")
        if not t.done_items():
            errors.append(f"{tid}: no Done-when checkboxes")
        if not t.owns and tid.startswith("T-"):
            errors.append(f"{tid}: empty Owns")
        for d in t.deps:
            if d not in board_ids and not (d in tickets and tickets[d].status == "done"):
                errors.append(f"{tid}: depends on {d}, which is not on the board or done")
        if tid in ancestors(tid, tickets):
            errors.append(f"{tid}: dependency cycle")
        g = groups.get(tid, "")
        if g.isdigit():
            per_group.setdefault(g, []).append(tid)
            for d in t.deps:
                dg = groups.get(d, "")
                if dg.isdigit() and int(dg) >= int(g):
                    errors.append(f"{tid}: group {g} but depends on {d} in group {dg}")
        if not t.bullets("Specialists"):
            errors.append(f"{tid}: empty Specialists")
    for g, ids in per_group.items():
        inline = [i for i in ids if i.startswith("T-")]
        if len(inline) > 3:
            warns.append(f"group {g}: {len(inline)} tickets (cap is 3 workers at once)")
    active = [tickets[i] for i in board_ids if i in tickets]
    for i, a in enumerate(active):
        for b in active[i + 1:]:
            if a.id in ancestors(b.id, tickets) or b.id in ancestors(a.id, tickets):
                continue  # sequenced, so sharing is safe
            for pa in a.owns:
                for pb in b.owns:
                    if overlap(pa, pb):
                        errors.append(f"{a.id} and {b.id} both own {pa if len(pa) <= len(pb) else pb} and run unsequenced")
    for w in warns:
        print("WARN", w)
    for e in errors:
        print("FAIL", e)
    if errors:
        sys.exit(1)
    print(f"PASS board '{title}': {len(rows)} rows, {len(active)} ticket files")


def cmd_resume(_args):
    title, _header, rows = open_board()
    if not rows:
        print("No open board. Start with /orchestrate <goal>.")
        return
    tickets = ticket_files()
    status = {r["ID"]: (tickets[r["ID"]].status if r["ID"] in tickets else r.get("Status", "")) for r in rows}
    print(f"Board: {title}")
    for r in rows:
        tid = r["ID"]
        t = tickets.get(tid)
        deps = t.deps if t else ID_RE.findall(r.get("Depends on", ""))
        ready = status[tid] == "todo" and all(status.get(d, tickets[d].status if d in tickets else "") == "done" for d in deps)
        mark = " READY" if ready else ""
        print(f"  {tid:5} {status[tid]:11} g{r.get('Parallel group', '?'):6} deps={','.join(deps) or '-':12} {r.get('Title', '')[:52]}{mark}")
        if status[tid] == "blocked" and t:
            reason = [b for b in t.bullets("Handoff") if b.lower().startswith("blocked reason")]
            if reason:
                print(f"        {reason[0][:140]}")
    reports = sorted(p.name for p in (TICKETS / "reviews").glob("*.md")) if (TICKETS / "reviews").exists() else []
    open_ids = {tid for tid, s in status.items() if s != "done"}
    rel = [n for n in reports if n.split("-")[0] + "-" + n.split("-")[1] in open_ids] if reports else []
    if rel:
        print("Review reports for open tickets: " + ", ".join(rel))
    branch = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print(f"Branch: {branch}")
    scope_report([t for tid, t in tickets.items() if status.get(tid) in ("in-progress", "review", "blocked")], quiet_ok=False)


def scope_report(owners, quiet_ok=True):
    """Print changed paths by owner. Returns the list of unowned paths."""
    unowned, owned = [], {}
    for p in changed_paths():
        if p == "tickets/BOARD.md" or p.startswith("tickets/reviews/") or re.match(r"tickets/[TM]-\d+", p):
            continue
        who = [t.id for t in owners if any(covers(o, p) for o in t.owns)]
        if who:
            owned.setdefault(",".join(who), []).append(p)
        else:
            unowned.append(p)
    if owned or not quiet_ok:
        for who, ps in owned.items():
            print(f"  changed, owned by {who}: {len(ps)} path(s)")
    for p in unowned:
        print(f"  changed, UNOWNED: {p}")
    if not owned and not unowned and not quiet_ok:
        print("  working tree clean (outside tickets/)")
    return unowned


def cmd_scope(args):
    tickets = ticket_files()
    if args.ids:
        owners = [find_ticket(i) for i in args.ids]
    else:
        _t, _h, rows = open_board()
        owners = [tickets[r["ID"]] for r in rows if r["ID"] in tickets and tickets[r["ID"]].status != "done"]
    unowned = scope_report(owners)
    if unowned:
        sys.exit(1)
    print("PASS scope")


def cmd_items(args):
    t = find_ticket(args.id)
    for n, (_i, checked, text) in enumerate(t.done_items(), 1):
        print(f"{n}. [{'x' if checked else ' '}] {text[:110]}")


def set_status(t: Ticket, status: str):
    if status not in STATUSES:
        sys.exit(f"status must be one of {', '.join(STATUSES)}")
    text = re.sub(r"^Status:.*$", f"Status: {status}", t.text, count=1, flags=re.M)
    t.path.write_text(text)
    t.text, t.status = text, status
    if BOARD.exists():
        lines = BOARD.read_text().splitlines(keepends=True)
        header = None
        for i, line in enumerate(lines):
            if line.startswith("## Previous board"):
                break
            if line.startswith("|"):
                cells = line.strip().strip("|").split("|")
                if header is None:
                    header = [c.strip() for c in cells]
                    continue
                if cells and cells[0].strip() == t.id and "Status" in header:
                    k = header.index("Status")
                    width = len(cells[k])
                    cells[k] = f" {status}".ljust(width)
                    lines[i] = "|" + "|".join(cells) + "|\n"
                    break
            elif header is not None and line.strip():
                header = None
        BOARD.write_text("".join(lines))


def format_tickets(paths=None):
    """Ticket files are bookkeeping, so keep them formatted automatically."""
    paths = paths or [str(p.relative_to(ROOT)) for p in TICKETS.glob("*.md")]
    run(["npx", "--no-install", "prettier", "--write", "--log-level", "warn", *paths])


def cmd_status(args):
    t = find_ticket(args.id)
    set_status(t, args.status)
    format_tickets([str(t.path.relative_to(ROOT)), "tickets/BOARD.md"])
    print(f"{t.id}: {args.status}")


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


def cmd_accept(args):
    t = find_ticket(args.id)
    items = t.done_items()
    met = set()
    for part in (args.met or "").split(","):
        if part.strip():
            if not part.strip().isdigit() or not 1 <= int(part) <= len(items):
                sys.exit(f"--met: '{part}' is not an item number 1..{len(items)} (see: orch.py items {t.id})")
            met.add(int(part))
    unmet = [n for n in range(1, len(items) + 1) if n not in met]
    if unmet and not args.unmet:
        sys.exit(f"Done-when items {unmet} not listed in --met. Verify them, or pass --unmet REASON.")
    staged = run(["git", "diff", "--cached", "--name-only"]).stdout.split()
    if staged:
        sys.exit("other changes are already staged; commit or unstage them first:\n  " + "\n  ".join(staged))
    paths = [p for p in changed_paths() if any(covers(o, p) for o in t.owns)]
    if not paths:
        sys.exit(f"{t.id}: no changed paths under its Owns")
    # Tick only the verified items, record any unmet ones, mark done.
    lines = t.text.splitlines(keepends=True)
    for n, (i, _c, _txt) in enumerate(items, 1):
        if n in met:
            lines[i] = re.sub(r"^- \[[ xX]\]", "- [x]", lines[i], count=1)
    text = "".join(lines)
    if unmet:
        note = f"- Accepted with Done-when items {', '.join(map(str, unmet))} unmet: {args.unmet}\n"
        text = re.sub(r"(^## Handoff\s*\n(?:\s*\n)?)", r"\1" + note.replace("\\", r"\\"), text, count=1, flags=re.M)
    t.path.write_text(text)
    t.text = text
    set_status(t, "done")
    ticket_rel = str(t.path.relative_to(ROOT))
    commit_set = paths + [ticket_rel, "tickets/BOARD.md"]
    existing = [p for p in commit_set if (ROOT / p).exists()]
    fmt = run(["npx", "--no-install", "prettier", "--write", "--ignore-unknown", "--log-level", "warn", *existing])
    if fmt.returncode != 0:
        sys.exit("prettier failed:\n" + (fmt.stdout + fmt.stderr)[-1500:])
    add = run(["git", "add", "-A", "--", *commit_set])
    if add.returncode != 0:
        sys.exit("git add failed:\n" + add.stderr)
    staged = set(run(["git", "diff", "--cached", "--name-only"]).stdout.split())
    stray = sorted(p for p in staged if p not in commit_set)
    if stray:
        run(["git", "reset", "-q", "--", *staged])
        sys.exit("unexpected staged paths, nothing committed:\n  " + "\n  ".join(stray))
    msg = [f"{t.id}: {t.title}"]
    if args.trailer:
        msg += ["", args.trailer]
    c = run(["git", "commit", "-q", "-m", "\n".join(msg)])
    if c.returncode != 0:
        sys.exit("commit failed:\n" + (c.stdout + c.stderr)[-2000:])
    stat = run(["git", "show", "--shortstat", "--format=%h %s", "HEAD"]).stdout.split("\n")
    print(f"{stat[0]} |{stat[-2] if len(stat) > 1 else ''}")


# ---------- checks ----------

def which_ruff():
    for cmd in (["ruff"], [str(ROOT / "backend/venv/bin/ruff")], [sys.executable, "-m", "ruff"]):
        try:
            if subprocess.run(cmd + ["--version"], capture_output=True).returncode == 0:
                return cmd
        except OSError:
            continue
    return None


def which_pytest():
    venv = ROOT / "backend/venv/bin/pytest"
    if venv.exists():
        return [str(venv)]
    if shutil.which("pytest"):
        return ["pytest"]
    return [sys.executable, "-m", "pytest"]


def regen_route_types(force: bool) -> str:
    """Typed routes live in .expo/types/router.d.ts and only regenerate under
    `expo start`. Refresh them when route files were added, removed or renamed,
    so tsc doesn't report false errors."""
    types = ROOT / ".expo/types/router.d.ts"
    out = run(["git", "status", "--porcelain=v1", "-uall", "--", "app/"]).stdout
    structural = [ln for ln in out.splitlines() if ln[:2].strip() in ("??", "A", "D", "R", "AM", "RM")]
    if types.exists() and not structural and not force:
        return ""
    if types.exists() and force and not structural:
        newest = max((p.stat().st_mtime for p in (ROOT / "app").rglob("*.tsx")), default=0)
        if newest <= types.stat().st_mtime:
            return ""
    before = types.stat().st_mtime if types.exists() else 0
    env = dict(os.environ, CI="1")
    proc = subprocess.Popen(["npx", "expo", "start", "--offline", "--port", "8099"], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        for _ in range(90):
            if types.exists() and types.stat().st_mtime > before:
                time.sleep(1)
                return "INFO route types regenerated"
            time.sleep(1)
        return "WARN route types not regenerated in 90s; tsc errors about routes may be stale"
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def run_check(name, cmd, timeout=900):
    LOGS.mkdir(parents=True, exist_ok=True)
    log = LOGS / f"{name.replace(' ', '-')}.log"
    start = time.time()
    try:
        p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        out, ok = p.stdout, p.returncode == 0
    except subprocess.TimeoutExpired as e:
        raw = e.stdout or b""
        out = raw.decode(errors="replace") if isinstance(raw, bytes) else raw
        out, ok = out + f"\nTIMEOUT after {timeout}s", False
    log.write_text(out)
    return name, ok, time.time() - start, out, log


def summary_tail(name, out):
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    if name.startswith("backend tests") and lines:
        return lines[-1].strip("= ")
    return ""


def cmd_check(args):
    changed = changed_paths()
    backend = args.all or any(p.startswith("backend/") for p in changed)
    frontend = args.all or any(
        not p.startswith(("backend/", "supabase/", "tickets/", "docs/")) and p.endswith((".ts", ".tsx", ".js", ".jsx", ".json"))
        for p in changed)
    lines, failed = [], False
    if args.ids:
        owners = [find_ticket(i) for i in args.ids]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            unowned = scope_report(owners)
        if unowned:
            failed = True
            lines.append("FAIL scope: unowned changes: " + ", ".join(unowned[:8]) + (" ..." if len(unowned) > 8 else ""))
        else:
            lines.append(f"PASS scope ({', '.join(args.ids)})")
    format_tickets()
    jobs = [("format", ["npx", "--no-install", "prettier", "--check", PRETTIER_GLOB])]
    if frontend:
        note = regen_route_types(force=args.all)
        if note:
            lines.append(note)
        jobs += [("lint", ["npx", "expo", "lint"]), ("types", ["npx", "tsc", "--noEmit"])]
        if args.all:
            jobs.append(("expo doctor", ["npx", "expo-doctor"]))
    if backend:
        ruff = which_ruff()
        if ruff:
            jobs.append(("backend lint", ruff + ["check", "backend/"]))
        else:
            lines.append("FAIL backend lint: ruff not found (backend/venv/bin/pip install ruff)")
            failed = True
        jobs.append(("backend tests", which_pytest() + ["backend/tests/", "-q", "-p", "no:cacheprovider"]))
    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        results = list(ex.map(lambda j: run_check(*j), jobs))
    if backend and args.repeat > 1:
        idx = next(i for i, r in enumerate(results) if r[0] == "backend tests")
        if results[idx][1]:
            cmd, total = dict(jobs)["backend tests"], results[idx][2]
            for k in range(2, args.repeat + 1):
                name, ok, secs, out, log = run_check("backend tests", cmd)
                total += secs
                if not ok:
                    results[idx] = (f"backend tests (run {k} of {args.repeat})", ok, secs, out, log)
                    break
            else:
                results[idx] = (f"backend tests x{args.repeat}", True, total, results[idx][3], results[idx][4])
    for name, ok, secs, out, log in results:
        tail = summary_tail(name, out)
        if ok:
            lines.append(f"PASS {name} ({secs:.0f}s){': ' + tail if tail else ''}")
        else:
            failed = True
            rel = log.relative_to(ROOT)
            body = [ln for ln in out.strip().splitlines() if ln.strip()][-12:]
            lines.append(f"FAIL {name} ({secs:.0f}s), full log {rel}:")
            lines += ["    " + ln[:200] for ln in body]
    skipped = [s for s, on in (("frontend", frontend), ("backend", backend)) if not on]
    if skipped:
        lines.append(f"SKIP {' and '.join(skipped)} checks (no changes there; --all runs everything)")
    print("\n".join(lines))
    sys.exit(1 if failed else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate").set_defaults(fn=cmd_validate)
    sub.add_parser("resume").set_defaults(fn=cmd_resume)
    p = sub.add_parser("items")
    p.add_argument("id")
    p.set_defaults(fn=cmd_items)
    p = sub.add_parser("status")
    p.add_argument("id")
    p.add_argument("status")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("scope")
    p.add_argument("ids", nargs="*")
    p.set_defaults(fn=cmd_scope)
    p = sub.add_parser("check")
    p.add_argument("ids", nargs="*")
    p.add_argument("--all", action="store_true", help="run every check (before a PR)")
    p.add_argument("--repeat", type=int, default=1, help="run backend tests N times")
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("accept")
    p.add_argument("id")
    p.add_argument("--met", default="", help="comma-separated Done-when item numbers verified as met")
    p.add_argument("--unmet", default="", help="reason, required if any item is not in --met")
    p.add_argument("--trailer", default="", help="commit trailer, e.g. a Co-Authored-By line")
    p.set_defaults(fn=cmd_accept)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
