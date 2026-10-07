import pytest

from services.photo_paths import server_photo_path

TEAM = "22222222-2222-2222-2222-222222222222"
TASK = "44444444-4444-4444-4444-444444444444"
OTHER = "33333333-3333-3333-3333-333333333333"
FILE_ID = "55555555-5555-4555-8555-555555555555"
# UUIDs with hex letters, so upper-casing them changes the string.
LTEAM = "abcdef12-3333-4333-8333-abcdefabcdef"
LTASK = "fedcba98-4444-4444-8444-fedcbafedcba"
LFILE = "abcdefab-5555-4555-8555-abcdefabcdef"


def _path(team=TEAM, task=TASK, name=FILE_ID, ext="png"):
    return f"{team}/{task}/{name}.{ext}"


@pytest.mark.parametrize("ext", ["jpg", "png", "webp", "heic", "heif", "jpeg"])
def test_own_path_passes(ext):
    p = _path(ext=ext)
    assert server_photo_path(p, TEAM, TASK) == p


def test_letter_uuids_pass_in_lowercase_only():
    p = _path(team=LTEAM, task=LTASK, name=LFILE)
    assert server_photo_path(p, LTEAM, LTASK) == p
    assert server_photo_path(p.upper(), LTEAM, LTASK) is None


def test_ids_may_be_supplied_in_non_canonical_case():
    p = _path(team=LTEAM, task=LTASK, name=LFILE)
    assert server_photo_path(p, LTEAM.upper(), LTASK.upper()) == p


@pytest.mark.parametrize(
    "bad",
    [
        _path(team=OTHER),  # other team's folder
        _path(task=OTHER),  # other task's folder
        _path(team=LTEAM.upper(), task=LTASK, name=LFILE),  # upper-case UUIDs in the path
        _path(team=LTEAM, task=LTASK.upper(), name=LFILE),
        _path(team=LTEAM, task=LTASK, name=LFILE.upper()),
        _path(team=TEAM.replace("-", "")),  # non-canonical (no hyphens)
        _path(team="{" + TEAM + "}"),
        _path(name="stolen"),  # not a UUID filename
        _path(ext="gif"),
        _path(ext="exe"),
        _path(ext="PNG"),
        f"{TEAM}/{TASK}/../{OTHER}/{TASK}/{FILE_ID}.png",
        f"../{TEAM}/{TASK}/{FILE_ID}.png",
        f"{TEAM}/{TASK}/../{FILE_ID}.png",
        f"extra/{_path()}",
        f"{_path()}/extra",
        f"{TEAM}/{TASK}/sub/{FILE_ID}.png",
        f"/{_path()}",
        f"{_path()}\n",  # fullmatch, not match: no trailing newline
        f" {_path()}",
        f"{_path()}.png",
        "",
    ],
)
def test_other_paths_are_rejected(bad):
    assert server_photo_path(bad, TEAM, TASK) is None


@pytest.mark.parametrize("value", [None, 0, 123, b"bytes", [_path()], {"p": _path()}, ("a",), False])
def test_non_string_or_empty_values_are_rejected(value):
    assert server_photo_path(value, TEAM, TASK) is None


@pytest.mark.parametrize("bad_id", [None, "", "team1", 5, "not-a-uuid"])
def test_non_uuid_row_ids_are_rejected(bad_id):
    assert server_photo_path(_path(), bad_id, TASK) is None
    assert server_photo_path(_path(), TEAM, bad_id) is None
