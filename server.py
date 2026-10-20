import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "events.db"
HOST = "127.0.0.1"
PORT = 8000


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/events":
            self._serve_events()
        elif path in ("/", "/index.html"):
            self._serve_dashboard()
        elif path == "/events.css":
            self._serve_static("events.css", "text/css; charset=utf-8")
        elif path == "/events.js":
            self._serve_static("events.js", "text/javascript; charset=utf-8")
        else:
            self.send_error(404, "Not found")

    def _send_bytes(self, content, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def _serve_dashboard(self):
        try:
            content = (BASE_DIR / "index.html").read_bytes()
        except OSError as error:
            self.send_error(500, f"Could not read dashboard: {error}")
            return
        self._send_bytes(content, "text/html; charset=utf-8")

    def _serve_static(self, filename, content_type):
        try:
            content = (BASE_DIR / filename).read_bytes()
        except OSError as error:
            self.send_error(500, f"Could not read {filename}: {error}")
            return
        self._send_bytes(content, content_type)

    def _serve_events(self):
        if not DATABASE.is_file():
            self.send_error(500, f"Database not found: {DATABASE.name}")
            return

        try:
            with sqlite3.connect(f"{DATABASE.as_uri()}?mode=ro", uri=True) as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute(
                    """
                    SELECT Area, Club, Event, Course, Length, Climb, Controls,
                           Minutes, Seconds, Date, Scale, "Contour interval",
                           Country, Punch, Time, Year
                    FROM events
                    ORDER BY Year DESC, Date DESC, Area COLLATE NOCASE
                    """
                )
                events = [dict(row) for row in rows]
        except sqlite3.Error as error:
            self.send_error(500, f"Could not read events database: {error}")
            return

        content = json.dumps(events, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self._send_bytes(content, "application/json; charset=utf-8")

    def log_message(self, format_string, *args):
        super().log_message(format_string, *args)


if __name__ == "__main__":
    if not DATABASE.is_file():
        raise SystemExit(f"Database not found: {DATABASE}")
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Events dashboard available at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server.")
    finally:
        server.server_close()
