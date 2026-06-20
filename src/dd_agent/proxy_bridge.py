"""In-process HTTP→SOCKS5 forward proxy, so the spawned deep-research agents' web traffic
(WebFetch / WebSearch + the WebFetch domain-safety check that calls claude.ai) can be routed
through a stable upstream SOCKS5 — typically the gpu's tailscale userspace SOCKS (localhost:1055,
which exits via a stable relay), instead of the box's flaky direct egress.

The Claude Code CLI honours http_proxy/https_proxy (an HTTP proxy), not SOCKS, so we expose a
tiny HTTP-CONNECT proxy here and tunnel it to the SOCKS5 upstream. Pure stdlib (manual SOCKS5
handshake — no python-socks dependency). Runs as an asyncio server inside the backend process;
no separate daemon. Opt-in via DD_AGENT_PROXY_SOCKS; see api startup + run_agent env injection.
"""
from __future__ import annotations

import asyncio
from urllib.parse import urlsplit


async def _socks5_connect(socks_host: str, socks_port: int, dst_host: str, dst_port: int):
    """Open a SOCKS5 (no-auth) tunnel to dst via the upstream socks; the socks server resolves
    dst_host (socks5h semantics). Returns the upstream (reader, writer)."""
    reader, writer = await asyncio.open_connection(socks_host, socks_port)
    # greeting: VER=5, NMETHODS=1, METHOD=0 (no auth)
    writer.write(b"\x05\x01\x00")
    await writer.drain()
    if (await reader.readexactly(2))[1] != 0x00:
        writer.close()
        raise OSError("socks5: no acceptable auth method")
    try:
        host_b = dst_host.encode("ascii")          # hostnames + IP literals (the common case)
    except UnicodeEncodeError:
        host_b = dst_host.encode("idna")            # internationalized domain names
    # CONNECT: VER=5 CMD=1 RSV=0 ATYP=3(domain) LEN host PORT
    writer.write(b"\x05\x01\x00\x03" + bytes([len(host_b)]) + host_b + dst_port.to_bytes(2, "big"))
    await writer.drain()
    rep = await reader.readexactly(4)
    if rep[1] != 0x00:
        writer.close()
        raise OSError(f"socks5: connect failed (rep={rep[1]})")
    atyp = rep[3]
    if atyp == 0x01:
        await reader.readexactly(4)
    elif atyp == 0x03:
        await reader.readexactly((await reader.readexactly(1))[0])
    elif atyp == 0x04:
        await reader.readexactly(16)
    await reader.readexactly(2)  # bound port
    return reader, writer


async def _pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await r.read(65536)
            if not data:
                break
            w.write(data)
            await w.drain()
    except Exception:  # noqa: BLE001 — connection teardown is best-effort
        pass
    finally:
        try:
            w.close()
        except Exception:  # noqa: BLE001
            pass


def _make_handler(socks_host: str, socks_port: int):
    async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
        up_writer = None
        try:
            request_line = await client_reader.readline()
            if not request_line:
                return
            parts = request_line.split()
            if len(parts) < 2:
                return
            method, target = parts[0].decode("latin1"), parts[1].decode("latin1")

            # consume request headers up to the blank line
            headers = []
            while True:
                line = await client_reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
                headers.append(line)

            if method.upper() == "CONNECT":
                host, _, port = target.partition(":")
                up_reader, up_writer = await _socks5_connect(socks_host, socks_port, host, int(port or 443))
                client_writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                await client_writer.drain()
            else:  # absolute-form HTTP (e.g. GET http://host/path)
                u = urlsplit(target)
                host, port = u.hostname or "", u.port or 80
                if not host:
                    return
                up_reader, up_writer = await _socks5_connect(socks_host, socks_port, host, port)
                path = u.path or "/"
                if u.query:
                    path += "?" + u.query
                up_writer.write(f"{method} {path} HTTP/1.1\r\n".encode("latin1"))
                for h in headers:
                    up_writer.write(h)
                up_writer.write(b"\r\n")
                await up_writer.drain()

            await asyncio.gather(_pipe(client_reader, up_writer), _pipe(up_reader, client_writer))
        except Exception:  # noqa: BLE001 — never let one bad connection crash the server
            try:
                client_writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                await client_writer.drain()
            except Exception:  # noqa: BLE001
                pass
        finally:
            for wtr in (client_writer, up_writer):
                try:
                    if wtr is not None:
                        wtr.close()
                except Exception:  # noqa: BLE001
                    pass

    return handle


async def start_bridge(listen_host: str, listen_port: int, socks_host: str, socks_port: int):
    """Start the HTTP-CONNECT→SOCKS5 bridge on the current event loop. Returns the asyncio server
    (kept alive by the caller; serves in the background for the loop's lifetime)."""
    server = await asyncio.start_server(
        _make_handler(socks_host, socks_port), listen_host, listen_port)
    return server
