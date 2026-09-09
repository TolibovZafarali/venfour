"""Run unit tests without credentials; reject and report unmocked network work.

Use an operating-system network sandbox as an additional boundary. This runner
does not load environment files. Provider fixtures must inject their own values.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path
import socket
import sys
import unittest


class OfflineNetworkGuard:
    def __init__(self) -> None:
        self.violations: list[str] = []
        self.expected_probes = 0
        self._probing = False

    def reject(self, operation: str) -> None:
        if self._probing:
            self.expected_probes += 1
        else:
            self.violations.append(operation)
            print(f"OFFLINE NETWORK VIOLATION: {operation}", file=sys.stderr, flush=True)
        raise AssertionError(f"Offline tests prohibit unmocked network work: {operation}")

    def audit(self, event: str, args: tuple) -> None:
        if event == "socket.getaddrinfo":
            try:
                ipaddress.ip_address(args[0])
            except (ValueError, TypeError):
                self.reject("DNS resolution")
        elif event in {"socket.gethostbyname", "socket.gethostbyaddr", "socket.getnameinfo"}:
            self.reject("DNS resolution")
        elif event in {"socket.connect", "socket.sendto", "socket.sendmsg"}:
            if args[0].family in {socket.AF_INET, socket.AF_INET6}:
                self.reject(event)
        elif event in {"subprocess.Popen", "os.system", "os.posix_spawn"}:
            self.reject("unmocked child process")

    def install(self) -> None:
        import httpx

        sys.addaudithook(self.audit)
        guard = self

        def reject_http(_transport, _request):
            guard.reject("HTTP transport")

        async def reject_async_http(_transport, _request):
            guard.reject("asynchronous HTTP transport")

        httpx.HTTPTransport.handle_request = reject_http
        httpx.AsyncHTTPTransport.handle_async_request = reject_async_http

    def check(self) -> None:
        import httpx

        self._probing = True
        try:
            def direct_connection() -> None:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
                    connection.connect(("127.0.0.1", 9))

            for operation in (
                lambda: socket.getaddrinfo("api.marketcheck.com", 443),
                lambda: httpx.HTTPTransport().handle_request(
                    httpx.Request("GET", "https://api.marketcheck.com/offline-guard-probe")
                ),
                direct_connection,
            ):
                try:
                    operation()
                except AssertionError:
                    pass
                else:
                    raise RuntimeError("Offline network guard probe failed")
        finally:
            self._probing = False
        if self.expected_probes != 3 or self.violations:
            raise RuntimeError("Offline network guard failed its startup checks")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tests", nargs="*", help="Optional unittest names; default is complete discovery")
    args = parser.parse_args()
    # Do not inherit provider credentials, proxy settings, or production config.
    os.environ.clear()
    os.environ.update({"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
    sys.dont_write_bytecode = True
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    sys.path.insert(0, str(root))
    # Match discovery's import path when explicit module batches are selected.
    sys.path.insert(1, str(root / "tests"))
    guard = OfflineNetworkGuard()
    guard.install()
    guard.check()
    print("Credentials cleared; DNS, real HTTP, and direct socket guard probes blocked before network activity.", flush=True)
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromNames(args.tests) if args.tests else loader.discover("tests")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        f"OFFLINE SUMMARY: tests={result.testsRun}; failures={len(result.failures)}; "
        f"errors={len(result.errors)}; skipped={len(result.skipped)}; "
        f"unexpected_network_attempts={len(guard.violations)}; "
        f"blocked_guard_probes={guard.expected_probes}",
        flush=True,
    )
    return 0 if result.wasSuccessful() and not guard.violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
