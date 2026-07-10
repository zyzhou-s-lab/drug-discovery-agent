"""End-to-end test for the in-process HTTP→SOCKS5 bridge, fully offline: a mock SOCKS5 server +
a mock target echo server, so the CONNECT tunnel is exercised without any real network."""
import asyncio

import pytest

from dd_agent.proxy_bridge import start_bridge


async def _serve(handler):
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


async def _copy(r, w):
    try:
        while True:
            data = await r.read(65536)
            if not data:
                break
            w.write(data)
            await w.drain()
    finally:
        w.close()


@pytest.mark.asyncio
async def test_bridge_connect_tunnels_through_socks():
    # target: echo "ECHO:" + whatever it receives, once
    async def echo(r, w):
        data = await r.read(100)
        w.write(b"ECHO:" + data)
        await w.drain()
        w.close()

    target, tport = await _serve(echo)

    # minimal no-auth SOCKS5 server: handshake -> CONNECT(host,port) -> pipe to target
    async def socks(r, w):
        await r.readexactly(3)                       # VER NMETHODS METHOD(1 byte)
        w.write(b"\x05\x00")                          # choose no-auth
        await w.drain()
        hdr = await r.readexactly(4)                  # VER CMD RSV ATYP
        assert hdr[3] == 0x03                         # domain (socks5h)
        ln = (await r.readexactly(1))[0]
        host = (await r.readexactly(ln)).decode()
        port = int.from_bytes(await r.readexactly(2), "big")
        w.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")  # success reply
        await w.drain()
        ur, uw = await asyncio.open_connection(host, port)
        await asyncio.gather(_copy(r, uw), _copy(ur, w))

    socks_srv, sport = await _serve(socks)
    bridge = await start_bridge("127.0.0.1", 0, "127.0.0.1", sport)
    bport = bridge.sockets[0].getsockname()[1]

    # client speaks HTTP CONNECT to the bridge, then tunnels bytes to the target
    cr, cw = await asyncio.open_connection("127.0.0.1", bport)
    cw.write(f"CONNECT 127.0.0.1:{tport} HTTP/1.1\r\n\r\n".encode())
    await cw.drain()
    status = await asyncio.wait_for(cr.readline(), timeout=5)
    assert b"200" in status
    await cr.readline()                               # blank line after the 200
    cw.write(b"hello")
    await cw.drain()
    resp = await asyncio.wait_for(cr.read(100), timeout=5)
    assert resp == b"ECHO:hello"

    cw.close()
    for s in (bridge, socks_srv, target):
        s.close()
