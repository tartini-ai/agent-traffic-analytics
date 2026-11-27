"""Deleting sessions: every trace of a session, every tab of it, so that nothing of it can be found afterwards.

delete_sessions(ids, now_ms) is the one way to delete, run by the process that owns the data folder: the command line
calls it when cake is not running (delete_command.py), and the running cake calls it for POST /api/delete
(api/deletion.py), which the settings page and `agentcake delete` use while it runs. It holds store.LOCK, so collect,
the judging and the maintenance thread wait until it is done. A visit goes whole: for the given ids, it takes
every tab session of each visit one of them names (visit_join.whole_visits: a session id the dashboard shows, the id of
any of its tab sessions, or an id kept in the visitor's browser, which also names the sessions the collector cut from
a tab after 30 minutes or 24 hours), and:

1. checks that each chunk the chunks table gives a visit is that visit's (the chunk's header names it), then
   overwrites those bytes with zeros where they are. A chunk file is otherwise only appended to; the zeros are dead
   space like a dropped chunk's, and no row points into them. A chunk that names another visit stops everything
   before anything is changed (WipeRefused);
2. deletes its rows in one transaction with SQLite's secure_delete on (a deleted cell is zeroed, not only unlinked):
   chunks rows, open windows and 0.3.4 replay rows only through streams.drop_replay(), then every row of every other
   table with a session_id column (store.SESSION_TABLES: a table that keeps a session's rows names that column
   session_id), the sessions row and the visit's row (visits); in the database's own settings (what `agentcake migrate`
   recorded) the id becomes DELETED_MARK;
3. gives the space back the way the chunk files are compacted: space.reclaim_if_due() runs recompress.reclaim(), which deletes a file nothing
   live is in, compacts a mostly dead one and drops the stylesheets no chunk refers to (this hour's file stays; its
   dead bytes are the zeros of step 1);
4. rewrites the database file (VACUUM) and empties the write-ahead log (wal_checkpoint TRUNCATE). secure_delete does
   not reach the copies a b-tree page split leaves in unused page space, nor a deleted key kept as a divider in an
   index page; a rewritten file has neither. On a large database this takes a while;
5. deletes the same rows from each backup `agentcake migrate` or the upgrade to visits made (backups/), and the
   stylesheets no chunk of it refers to any more, and rewrites it the same way. An id missing from the live database
   can still name a visit in a backup, for example if the previous delete stopped before it cleaned the backup;
6. removes the lines of cake.log that name the ids, the visits' included, rewriting the file in place: `agentcake
   start` points the running cake's output at that file in append mode, so it goes on writing to it.

Running it again finishes a run that was cut short: wiped chunks are recognised and each step looks again at what is
left. preview(ids) counts what delete_sessions(ids) would remove and changes nothing (`agentcake delete --dry-run`).
Logs outside the data folder (systemd's journal, `docker logs`) are not cake's to rewrite: cake prints no visit data
there, only, rarely, a session id in an error.
"""
import json
import os
import re
import sqlite3
from contextlib import closing

from agentcake import paths, replay_chunks, space, store, streams, styles, visit_join
from agentcake.config import load_cfg
from agentcake.datafiles import sizes
from agentcake.storage_config import SETTINGS, now_ms as clock_ms

DELETED_MARK = "deleted"  # what a deleted id becomes inside the settings cake keeps about itself
ID = re.compile(r"[A-Za-z0-9]+")  # the only ids collect keeps (upload.py drops every other character)
SQLITE_MAGIC = b"SQLite format 3\x00"  # protocol: the first 16 bytes of every SQLite 3 database file
WIPED = object()  # what a chunk header read gives for bytes an earlier run overwrote with zeros
STREAM_TABLES = ("chunks", "open_chunks")  # streams.py's tables: in cake.db their rows go only through drop_replay()


class WipeRefused(replay_chunks.ChunkError):
    """A chunk the database gives a visit is not that visit's chunk: nothing was changed."""


def valid_id(text):
    """Whether text can be the id of a session cake keeps: letters and digits, at most max_chars.session_id of them."""
    return isinstance(text, str) and len(text) <= sizes()["max_chars"]["session_id"] and bool(ID.fullmatch(text))


def delete_sessions(ids, now_ms=None, cfg=SETTINGS):
    """Delete every trace of these sessions (see the module docstring); returns what was found and done."""
    ids = _checked(ids)
    now_ms = clock_ms() if now_ms is None else now_ms
    with store.LOCK:
        con = store.db()
        try:
            con.execute("PRAGMA secure_delete=ON")
            missing = _missing_live(con, ids)
            ids = visit_join.whole_visits(con, ids)
            visits = _visits_of(con, ids)
            found = _delete_rows(con, ids, visits, now_ms, cfg)
            reclaim = space.reclaim_if_due(con, now_ms, cfg)
            database = _rewrite(con)
        finally:
            con.close()
    backups, log_ids = _backup_reports(cfg, ids, visits, missing)
    return {"sessions": found, "reclaim": reclaim, "database": database, "backups": backups,
            "log_lines": scrub_log(paths.log_file(), log_ids)}


def preview(ids, cfg=SETTINGS):
    """What delete_sessions(ids) would remove, in the same shape, without changing anything."""
    ids = _checked(ids)
    con = store.db()
    try:
        missing = _missing_live(con, ids)
        ids = visit_join.whole_visits(con, ids)
        visits = _visits_of(con, ids)
        found = [_found(con, sid, _chunk_refs(con, sid)) for sid in ids]
    finally:
        con.close()
    backups, log_ids = _backup_reports(cfg, ids, visits, missing, dry_run=True)
    lines = _lines_naming(paths.log_file(), _id_pattern(log_ids, bytes))
    return {"sessions": found, "reclaim": None, "database": None, "backups": backups, "log_lines": lines}


def scrub_log(path, ids):
    """Remove the lines of a log file that name any of ids, rewriting it in place; returns how many were removed. A
    line the running cake appends while this reads is kept (and checked); one it appends between the rewrite and the
    truncation would be lost, a window of microseconds."""
    if not os.path.isfile(path):
        return 0
    pattern = _id_pattern(ids, bytes)
    with open(path, "r+b") as f:
        kept, removed = _without(f.read(), pattern)
        if not removed:
            return 0
        later, removed_later = _without(f.read(), pattern)
        f.seek(0)
        f.write(kept + later)
        f.truncate()
        f.flush()
        os.fsync(f.fileno())
    return removed + removed_later


def _checked(ids):
    ids = list(dict.fromkeys(ids))  # once each, in the order given
    bad = [i for i in ids if not valid_id(i)]
    if not ids or bad:
        raise ValueError(f"not session ids: {bad!r}" if bad else "no session id given")
    return ids


def _delete_rows(con, ids, visits, now_ms, cfg):
    """Steps 1 and 2 for every id, and the rows of these visits, in one transaction; returns what was found of each
    id."""
    con.execute("BEGIN IMMEDIATE")  # the write lock first: no other writer between the checks and the deletes
    try:
        refs = {sid: _chunk_refs(con, sid) for sid in ids}
        for sid, chunks in refs.items():
            _check_chunks(sid, chunks, cfg)
        found = [_found(con, sid, refs[sid]) for sid in ids]
        for sid in ids:
            _wipe(refs[sid], cfg)
            _drop(con, sid, cfg)
        _visit_rows(con, ids, visits)
        _scrub_settings(con, _named(ids, visits), now_ms)
        if any(item["found"] for item in found):
            store.mark_reclaim_due(con, now_ms)
        con.commit()
    except BaseException:
        con.rollback()
        raise
    return found


def _chunk_refs(con, sid):
    return con.execute("SELECT file, byte_offset, byte_length FROM chunks WHERE session_id=? ORDER BY file, byte_offset",
                       (sid,)).fetchall()


def _found(con, sid, chunks):
    rows = _row_counts(con, sid)
    return {"id": sid, "found": bool(rows), "rows": rows, "chunks": len(chunks),
            "chunk_bytes": sum(length for _, _, length in chunks)}


def _row_counts(con, sid):
    """{table: rows} of one session in every table that holds any (sessions included); {} when there are none."""
    counts = {table: con.execute(f"SELECT COUNT(*) FROM {table} WHERE session_id=?", (sid,)).fetchone()[0]
              for (table,) in con.execute(store.SESSION_TABLES).fetchall()}
    if _has_table(con, "sessions"):
        counts["sessions"] = con.execute("SELECT COUNT(*) FROM sessions WHERE id=?", (sid,)).fetchone()[0]
    return {table: n for table, n in counts.items() if n}


def _check_chunks(sid, chunks, cfg):
    for rel, offset, length in chunks:
        owner = _chunk_owner(rel, offset, length, cfg)
        if owner not in (sid, WIPED, None):
            raise WipeRefused(f"The replay data at {rel}@{offset} doesn't match the chunks table for session {sid}. "
                              "Nothing was deleted.")


def _chunk_owner(rel, offset, length, cfg):
    """The session a chunk's header names; WIPED for zeros; None when the file is gone or ends before the chunk's
    header does (a file cut short by a crash: nothing of the chunk's content is there to wipe)."""
    try:
        with open(os.path.join(replay_chunks.replay_dir(cfg), rel), "rb") as f:
            f.seek(offset)
            prefix = f.read(min(length, replay_chunks.PREFIX))
            if len(prefix) < min(length, replay_chunks.PREFIX):
                return None
            if not any(prefix):
                return WIPED
            if not prefix.startswith(replay_chunks.MAGIC):
                return f"no chunk at {rel}@{offset}"
            (size,) = replay_chunks.HEADER_LENGTH.unpack(prefix[len(replay_chunks.MAGIC):])
            text = f.read(size)
            if len(text) < size:
                return None
            header = json.loads(text)
    except FileNotFoundError:
        return None
    except ValueError:  # a header that is not JSON
        return f"no chunk at {rel}@{offset}"
    return header.get("session") if isinstance(header, dict) else None


def _wipe(chunks, cfg):
    """Overwrite these chunks' bytes with zeros, file by file, flushed to disk."""
    by_file = {}
    for rel, offset, length in chunks:
        by_file.setdefault(rel, []).append((offset, length))
    for rel, spans in by_file.items():
        try:
            f = open(os.path.join(replay_chunks.replay_dir(cfg), rel), "r+b")
        except FileNotFoundError:
            continue
        with f:
            size = os.fstat(f.fileno()).st_size
            for offset, length in spans:
                f.seek(offset)
                length = min(length, max(0, size - offset))  # zeros only over bytes that exist: never extend a file
                while length > 0:
                    piece = min(length, cfg["read_block_bytes"])
                    f.write(bytes(piece))
                    length -= piece
            f.flush()
            os.fsync(f.fileno())


def _drop(con, sid, cfg):
    """Every row of one session: its streams through streams.drop_replay() (every stream it has, a stream this cake
    does not know included), then each other table with a session_id column."""
    present = {name for (name,) in con.execute("SELECT stream FROM chunks WHERE session_id=? UNION "
                                               "SELECT stream FROM open_chunks WHERE session_id=?", (sid, sid))}
    streams.drop_replay(con, sid, sorted(present | set(cfg["streams"])), cfg)
    _delete_plain(con, sid, skip=STREAM_TABLES)


def _delete_plain(con, sid, skip=()):
    """Delete one session's rows by key from every table that has them but `skip` (in a backup, whose chunk rows only
    point at the live files: every table it has)."""
    for (table,) in con.execute(store.SESSION_TABLES).fetchall():
        if table not in skip:
            con.execute(f"DELETE FROM {table} WHERE session_id=?", (sid,))
    if _has_table(con, "sessions"):
        con.execute("DELETE FROM sessions WHERE id=?", (sid,))


def _visits_of(con, ids):
    """The ids of the visits these tab sessions belong to, each once."""
    if not _has_table(con, "visits"):
        return []
    found = []
    for part in store.parts(ids):
        found += [visit_id for (visit_id,) in con.execute(
            f"SELECT DISTINCT visit_id FROM session_web WHERE visit_id IS NOT NULL AND session_id IN "
            f"({','.join('?' * len(part))})", part)]
    return list(dict.fromkeys(found))


def _visit_rows(con, ids, visits, delete=True):
    """Delete (or with delete=False only count) the visits rows of a database that are these visits, or that are named
    after one of these tab sessions (a backup made before a late upload joined two visits). 0 without a visits table."""
    if not _has_table(con, "visits"):
        return 0
    count = 0
    for part in store.parts(_named(ids, visits)):
        where = f"id IN ({','.join('?' * len(part))})"
        count += con.execute(f"SELECT COUNT(*) FROM visits WHERE {where}", part).fetchone()[0]
        if delete:
            con.execute(f"DELETE FROM visits WHERE {where}", part)
    return count


def _named(ids, visits):
    """The tab sessions' ids, then the visits' (a browser session id names a visit and no tab session)."""
    return list(dict.fromkeys(list(ids) + list(visits)))


def _scrub_settings(con, ids, now_ms):
    if not _has_table(con, "settings"):
        return
    pattern = _id_pattern(ids, str)
    for key, value in con.execute("SELECT key, value FROM settings").fetchall():
        cleaned = pattern.sub(DELETED_MARK, value)  # an id is letters and digits: the JSON stays valid
        if cleaned != value:
            con.execute("UPDATE settings SET value=?, updated_ms=? WHERE key=?", (cleaned, now_ms, key))


def _rewrite(con):
    """Step 4: {vacuumed, log_cleared, error}. A failed VACUUM (no room on the disk for the copy) leaves the rows
    deleted and says why; running the delete again tries again."""
    error = None
    try:
        con.execute("VACUUM")
    except sqlite3.OperationalError as e:
        error = str(e)
    busy, _, _ = con.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    return {"vacuumed": error is None, "log_cleared": busy == 0, "error": error}


def _backups(cfg):
    folder = os.path.join(paths.home(), cfg["backup_dir"])
    if not os.path.isdir(folder):
        return []
    return [path for path in (os.path.join(folder, name) for name in sorted(os.listdir(folder)))
            if os.path.isfile(path) and _is_database(path)]


def _missing_live(con, ids):
    """Requested ids with no live session, visit membership or tab continuation."""
    return [sid for part in store.parts(ids) for (sid,) in con.execute(
        f"WITH named(id) AS (VALUES {','.join(['(?)'] * len(part))}) SELECT id FROM named "
        "WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE id=named.id) AND NOT EXISTS "
        "(SELECT 1 FROM session_web WHERE session_id=named.id OR visit_id=named.id OR tab_id=named.id)", part)]


def _backup_reports(cfg, ids, visits, missing, dry_run=False):
    backups, recovered = [], set()
    for path in _backups(cfg):
        report, tabs = _backup_report(path, ids, visits, missing, dry_run)
        backups.append(report)
        recovered.update(tabs)
    if recovered:  # a tab recovered from an old copy may belong to a different live visit now
        with closing(store.db()) as con:
            recovered = _missing_live(con, sorted(recovered))
    return backups, _named(_named(ids, visits), recovered)


def _backup_tabs(con, missing):
    """Find a missing live visit's own tabs in this copy, if it has visit metadata."""
    if not missing:
        return []
    columns = {row[1] for row in con.execute("PRAGMA table_info(session_web)")}
    if not {"session_id", "visit_id"} <= columns:
        return []
    return [sid for part in store.parts(missing) for (sid,) in con.execute(
        f"SELECT session_id FROM session_web WHERE visit_id IN ({','.join('?' * len(part))})", part) if valid_id(sid)]


def _backup_report(path, ids, visits, missing, dry_run):
    """Count a backup's matching rows and, unless previewing, delete them and rewrite it."""
    con = sqlite3.connect(path, timeout=load_cfg()["db_timeout_s"])
    try:
        if not dry_run:
            con.execute("PRAGMA secure_delete=ON")
            con.execute("BEGIN IMMEDIATE")
        tabs = _backup_tabs(con, missing)
        sessions = _named(ids, tabs)
        rows = sum(sum(_row_counts(con, sid).values()) for sid in sessions)
        # A recovered tab may also be the id of a different visit. Keep the original visit-row scope.
        report = {"file": _relative(path), "rows": rows + _visit_rows(con, ids, visits, delete=not dry_run)}
        if dry_run:
            return report, tabs
        for sid in sessions:
            _delete_plain(con, sid)
        if _has_table(con, "styles") and _has_table(con, "chunks"):
            styles.gc_styles(con)  # a stylesheet is kept once for every visit that showed it: drop the orphans
        _scrub_settings(con, sessions, clock_ms())
        con.commit()
        return {**report, **_rewrite(con)}, tabs
    finally:
        con.close()


def _is_database(path):
    with open(path, "rb") as f:
        return f.read(len(SQLITE_MAGIC)) == SQLITE_MAGIC


def _has_table(con, name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _relative(path):
    return os.path.relpath(path, paths.home()).replace(os.sep, "/")


def _id_pattern(ids, kind):
    """Any of the ids as a whole word (not inside a longer id), as a str or a bytes pattern."""
    alternatives = "|".join(map(re.escape, ids))
    pattern = f"(?<![A-Za-z0-9])(?:{alternatives})(?![A-Za-z0-9])"
    return re.compile(pattern.encode() if kind is bytes else pattern)


def _without(data, pattern):
    """(data without the lines that match, how many lines that was)."""
    kept, removed = [], 0
    for line in data.splitlines(keepends=True):
        if pattern.search(line):
            removed += 1
        else:
            kept.append(line)
    return b"".join(kept), removed


def _lines_naming(path, pattern):
    if not os.path.isfile(path):
        return 0
    with open(path, "rb") as f:
        return sum(1 for line in f if pattern.search(line))
