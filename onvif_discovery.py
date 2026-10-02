"""Loopback-only ONVIF WS-Discovery helper for the Sentinel browser app."""

from __future__ import annotations

import json
import logging
import socket
import time
import uuid
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse


ADDRESS = ("239.255.255.250", 3702)
MAX_DEVICES = 64
ALLOWED_HOSTS = {"127.0.0.1:8766", "localhost:8766"}
LOG = logging.getLogger("sentinel-onvif-discovery")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def is_allowed_origin(origin: str) -> bool:
    if not origin:
        return True
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    if hostname in {"localhost", "127.0.0.1", "::1"} and parsed.scheme in {"http", "https"}:
        return True
    return parsed.scheme == "https" and hostname == "jaffyyyyy.github.io"


def build_probe() -> bytes:
    message_id = f"urn:uuid:{uuid.uuid4()}"
    envelope = ET.Element("{http://www.w3.org/2003/05/soap-envelope}Envelope")
    header = ET.SubElement(envelope, "{http://www.w3.org/2003/05/soap-envelope}Header")
    ET.SubElement(header, "{http://www.w3.org/2005/08/addressing}MessageID").text = message_id
    ET.SubElement(header, "{http://www.w3.org/2005/08/addressing}To").text = "urn:schemas-xmlsoap-org:ws:2005:04:discovery"
    ET.SubElement(header, "{http://www.w3.org/2005/08/addressing}Action").text = "http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe"
    body = ET.SubElement(envelope, "{http://www.w3.org/2003/05/soap-envelope}Body")
    probe = ET.SubElement(body, "{http://schemas.xmlsoap.org/ws/2005/04/discovery}Probe")
    probe.set("xmlns:dn", "http://www.onvif.org/ver10/network/wsdl")
    ET.SubElement(probe, "{http://schemas.xmlsoap.org/ws/2005/04/discovery}Types").text = "dn:NetworkVideoTransmitter"
    return ET.tostring(envelope, encoding="utf-8", xml_declaration=True)


def parse_response(payload: bytes, source_ip: str) -> dict[str, object] | None:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return None

    values: dict[str, list[str]] = {}
    for element in root.iter():
        name = local_name(element.tag)
        if element.text and element.text.strip():
            values.setdefault(name, []).append(element.text.strip())

    xaddrs = []
    for value in values.get("XAddrs", []):
        xaddrs.extend(item for item in value.split() if item.startswith(("http://", "https://")))
    xaddrs = list(dict.fromkeys(xaddrs))[:8]
    if not xaddrs:
        return None

    scopes = values.get("Scopes", [""])[0]
    scope_items = scopes.split()
    name = unquote(next((item.rsplit("/", 1)[-1] for item in scope_items if "/name/" in item), ""))
    manufacturer = unquote(next((item.rsplit("/", 1)[-1] for item in scope_items if "/hardware/" in item), ""))
    model = unquote(next((item.rsplit("/", 1)[-1] for item in scope_items if "/model/" in item), ""))
    display_name = " ".join(part for part in (manufacturer, model, name) if part) or "ONVIF camera"
    endpoint = values.get("Address", [""])[0]
    return {
        "address": source_ip,
        "name": display_name[:200],
        "types": ", ".join(values.get("Types", []))[:200],
        "xaddrs": xaddrs,
        "endpoint": endpoint[:200],
    }


def discover(timeout_seconds: float) -> list[dict[str, object]]:
    probe = build_probe()
    devices: dict[str, dict[str, object]] = {}
    deadline = time.monotonic() + timeout_seconds
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("", 0))
        sock.sendto(probe, ADDRESS)
        while len(devices) < MAX_DEVICES:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            sock.settimeout(min(0.35, remaining))
            try:
                payload, source = sock.recvfrom(64 * 1024)
            except socket.timeout:
                continue
            except OSError:
                LOG.exception("ONVIF discovery socket failed")
                break
            device = parse_response(payload, source[0])
            if device:
                devices[str(device["endpoint"] or device["address"])] = device
    return sorted(devices.values(), key=lambda device: (str(device["name"]).lower(), str(device["address"])))


class DiscoveryHandler(BaseHTTPRequestHandler):
    server_version = "SentinelONVIFDiscovery/1.0"

    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin or "null")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if self.headers.get("Host", "").lower() not in ALLOWED_HOSTS or not is_allowed_origin(self.headers.get("Origin", "")):
            self.send_error(403, "Origin or host is not allowed")
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        if self.headers.get("Host", "").lower() not in ALLOWED_HOSTS or not is_allowed_origin(self.headers.get("Origin", "")):
            self.send_error(403, "Origin or host is not allowed")
            return
        parsed = urlparse(self.path)
        if parsed.path != "/api/discover":
            self.send_error(404, "Not found")
            return
        try:
            raw_timeout = parse_qs(parsed.query).get("timeout", ["3"])[0]
            timeout_seconds = max(1.0, min(5.0, float(raw_timeout)))
        except (TypeError, ValueError):
            self.send_error(400, "Invalid discovery timeout")
            return
        try:
            devices = discover(timeout_seconds)
        except OSError as error:
            LOG.exception("ONVIF discovery could not access the local network")
            self.send_error(503, f"Local network discovery failed: {error}")
            return
        payload = json.dumps({"devices": devices}, ensure_ascii=True).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format_string: str, *args: object) -> None:
        LOG.info("%s - %s", self.address_string(), format_string % args)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = ThreadingHTTPServer(("127.0.0.1", 8766), DiscoveryHandler)
    server.daemon_threads = True
    LOG.info("ONVIF discovery helper listening on http://127.0.0.1:8766 (loopback only)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOG.info("Stopping ONVIF discovery helper")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
