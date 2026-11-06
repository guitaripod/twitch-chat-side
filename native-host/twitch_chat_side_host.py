#!/usr/bin/env python3
"""Native messaging host for Twitch Chat Side.

Chromium on KDE Plasma (Wayland) often keeps reporting the old monitor after a
window moves, so this host asks KWin instead. For every window whose title
mentions Twitch it reports the name of the monitor holding most of it.

Protocol (Chrome native messaging: uint32 length prefix + UTF-8 JSON): the host
sends {"windows": [{"caption": str, "screen": str}]} whenever that list
changes, and exits when the browser closes stdin.
"""

import json
import os
import re
import struct
import subprocess
import sys
import threading
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

POLL_SECONDS = 0.4
OUTPUTS_TTL_SECONDS = 5
DBUS_TIMEOUT_MS = 1000
WINDOW_QUERY = "Twitch"
WINDOW_MATCH_PREFIX = "0_"
OUTPUT_FIELD_RE = re.compile(r"(\w+): (?:'([^']*)'|(-?\d+))")


def send(message):
    """Writes one native messaging frame, exiting once the browser has gone."""
    data = json.dumps(message).encode()
    try:
        sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
        sys.stdout.buffer.flush()
    except (BrokenPipeError, OSError):
        os._exit(0)


def exit_when_browser_closes():
    """Blocks until the browser closes stdin, then ends the process."""
    while sys.stdin.buffer.read(4096):
        pass
    os._exit(0)


def read_outputs():
    """Returns each monitor's name and logical rectangle, as the compositor describes them."""
    text = subprocess.run(
        ["wayland-info", "-i", "zxdg_output_manager_v1"],
        capture_output=True, text=True, timeout=5,
    ).stdout
    outputs = []
    for block in text.split("xdg_output_v1")[1:]:
        fields = {key: quoted if quoted else int(number) for key, quoted, number in OUTPUT_FIELD_RE.findall(block)}
        if {"description", "logical_x", "logical_y", "logical_width", "logical_height"} <= fields.keys():
            outputs.append(fields)
    return outputs


def overlap(window, output):
    """The area a window shares with a monitor."""
    width = min(window["x"] + window["width"], output["logical_x"] + output["logical_width"]) - max(window["x"], output["logical_x"])
    height = min(window["y"] + window["height"], output["logical_y"] + output["logical_height"]) - max(window["y"], output["logical_y"])
    return max(width, 0) * max(height, 0)


def kwin_call(bus, path, interface, method, argument):
    """Calls a KWin D-Bus method that takes one string and returns its single result."""
    reply = bus.call_sync(
        "org.kde.KWin", path, interface, method, GLib.Variant("(s)", (argument,)),
        None, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, None,
    )
    return reply.unpack()[0]


def twitch_windows(bus, outputs):
    """Lists the windows whose title mentions Twitch, with the monitor each one mostly sits on."""
    found = []
    for match in kwin_call(bus, "/WindowsRunner", "org.kde.krunner1", "Match", WINDOW_QUERY):
        match_id = match[0]
        if not match_id.startswith(WINDOW_MATCH_PREFIX):
            continue
        info = kwin_call(bus, "/KWin", "org.kde.KWin", "getWindowInfo", match_id[len(WINDOW_MATCH_PREFIX):])
        if not info or info.get("minimized"):
            continue
        best = max(outputs, key=lambda output: overlap(info, output), default=None)
        if best and overlap(info, best) > 0:
            found.append({"caption": info["caption"], "screen": best["description"]})
    return sorted(found, key=lambda window: window["caption"])


def main():
    """Reports Twitch windows' monitors to the extension until the browser disconnects."""
    threading.Thread(target=exit_when_browser_closes, daemon=True).start()
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    outputs, outputs_read_at, last = [], 0.0, None
    while True:
        now = time.monotonic()
        try:
            if now - outputs_read_at > OUTPUTS_TTL_SECONDS:
                outputs, outputs_read_at = read_outputs(), now
            report = {"windows": twitch_windows(bus, outputs)}
        except (GLib.Error, OSError, subprocess.SubprocessError) as error:
            report = {"windows": [], "error": str(error)}
        if report != last:
            send(report)
            last = report
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
