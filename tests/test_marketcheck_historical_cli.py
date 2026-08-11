from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from typing import Any
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from scripts import search_marketcheck_historical
from venfour.market import MarketProviderError
from venfour.marketcheck import (
    MARKETCHECK_HISTORICAL_MAX_PAGES,
    MARKETCHECK_PAST_INVENTORY_URL,
    MARKETCHECK_VIN_HISTORY_MAX_PAGES,
    MARKETCHECK_VIN_HISTORY_PAGE_SIZE,
    MARKETCHECK_VIN_HISTORY_URL,
    MarketCheckHistoricalProvider,
)


SYNTHETIC_KEY = "mc_test_history_credential"
AS_OF_DATE = date(2026, 8, 10)


def make_candidate(index: int, *, vin: str | None = None) -> dict[str, Any]:
    candidate_vin = vin or f"1VNF4UR{index:010d}"
    return {
        "id": f"candidate-{index}",
        "vin": candidate_vin,
        "price": 99_000 + index,
        "miles": 40_000 + index,
        "vdp_url": f"https://candidate.invalid/{index}",
        "source": "dealer.invalid",
        "dealer": {
            "name": "Synthetic Dealer",
            "city": "Fenton",
            "state": "MO",
            "zip": "63026",
        },
        "build": {
            "year": 2024,
            "make": "Hyundai",
            "model": "Elantra",
            "trim": "SEL",
        },
        "dist": 5 + index,
    }


def make_history(index: int, **overrides: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": f"history-{index}",
        "price": 24_000 + index,
        "miles": 46_000 + index,
        "vdp_url": f"https://history.invalid/{index}",
        "source": "dealer.invalid",
        "seller_type": "dealer",
        "inventory_type": "used",
        "seller_name": "Synthetic Dealer",
        "city": "Fenton",
        "state": "MO",
        "zip": "63026",
        "first_seen_at_date": "2026-05-18T00:00:00Z",
        "last_seen_at_date": "2026-05-20T00:00:00Z",
    }
    record.update(overrides)
    return record


class RecordingTransport:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def get(
        self,
        endpoint: str,
        params: dict[str, str | int],
        headers: dict[str, str],
        timeout: float,
    ) -> bytes:
        self.calls.append(
            {
                "endpoint": endpoint,
                "params": dict(params),
                "headers": dict(headers),
                "timeout": timeout,
            }
        )
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return json.dumps(response).encode("utf-8")


class MarketCheckHistoricalCliTests(unittest.TestCase):
    ELANTRA_ARGS = [
        "--date",
        "2026-05-19",
        "--year",
        "2024",
        "--make",
        "Hyundai",
        "--model",
        "Elantra",
        "--trim",
        "SEL",
        "--mileage",
        "46926",
        "--postal-code",
        "63026",
        "--radius",
        "50",
        "--limit",
        "10",
    ]
    CAMRY_ARGS = [
        "--date",
        "2025-08-14",
        "--year",
        "2025",
        "--make",
        "Toyota",
        "--model",
        "Camry",
        "--trim",
        "SE",
        "--mileage",
        "7192",
        "--postal-code",
        "63123",
        "--radius",
        "50",
        "--limit",
        "10",
    ]

    def run_supported(
        self,
        responses: list[Any],
        args: list[str] | None = None,
    ) -> tuple[int, str, str, RecordingTransport]:
        transport = RecordingTransport(responses)
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )
        stdout = io.StringIO()
        stderr = io.StringIO()
        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
            return_value=SYNTHETIC_KEY,
        ), patch.object(
            search_marketcheck_historical,
            "MarketCheckHistoricalProvider",
            return_value=provider,
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(
                args or self.ELANTRA_ARGS
            )
        return status, stdout.getvalue(), stderr.getvalue(), transport

    def test_out_of_range_prints_canonical_json_without_reading_key(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
        ) as read_api_key, redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(self.CAMRY_ARGS)

        document = json.loads(stdout.getvalue())
        self.assertEqual(status, 0)
        self.assertEqual(stderr.getvalue(), "")
        read_api_key.assert_not_called()
        self.assertEqual(document["provider"], "marketcheck")
        self.assertEqual(document["evidenceDate"], "2025-08-14")
        self.assertEqual(document["asOfDate"], "2026-08-10")
        self.assertEqual(document["coverage"]["status"], "OUT_OF_PROVIDER_RANGE")
        self.assertEqual(document["coverage"]["historyWindowDays"], 90)
        self.assertEqual(document["evidence"], [])
        self.assertEqual(document["listingCount"], 0)
        self.assertEqual(document["issues"], [])

    def test_supported_date_requires_environment_key(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
            return_value="",
        ) as read_api_key, redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(self.ELANTRA_ARGS)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("API key is required", stderr.getvalue())
        read_api_key.assert_called_once_with()

    def test_supported_empty_result_prints_only_canonical_json(self) -> None:
        transport = RecordingTransport([{"num_found": 0, "listings": []}])
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=transport,
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
            return_value=SYNTHETIC_KEY,
        ), patch.object(
            search_marketcheck_historical,
            "MarketCheckHistoricalProvider",
            return_value=provider,
        ) as provider_class, redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(self.ELANTRA_ARGS)

        document = json.loads(stdout.getvalue())
        self.assertEqual(status, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(document["coverage"]["status"], "SUPPORTED")
        self.assertEqual(document["listingCount"], 0)
        self.assertNotIn(SYNTHETIC_KEY, stdout.getvalue())
        provider_class.assert_called_once_with(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
        )
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(
            transport.calls[0]["endpoint"],
            MARKETCHECK_PAST_INVENTORY_URL,
        )

    def test_resolved_history_price_is_printed_instead_of_candidate_price(
        self,
    ) -> None:
        candidate = make_candidate(1)
        history = make_history(1, price=23_456)

        status, stdout, stderr, transport = self.run_supported(
            [
                {"num_found": 1, "listings": [candidate]},
                [history],
            ]
        )

        document = json.loads(stdout)
        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(document["listingCount"], 1)
        self.assertEqual(document["evidence"][0]["listing"]["price"], 23_456)
        self.assertNotEqual(
            document["evidence"][0]["listing"]["price"],
            candidate["price"],
        )
        self.assertEqual(
            transport.calls[1]["endpoint"],
            f"{MARKETCHECK_VIN_HISTORY_URL}/{candidate['vin']}",
        )

    def test_ambiguous_and_unresolved_histories_print_structured_issues(
        self,
    ) -> None:
        first = make_candidate(1)
        second = make_candidate(2)
        status, stdout, stderr, _ = self.run_supported(
            [
                {"num_found": 2, "listings": [first, second]},
                [make_history(1), make_history(2, price=30_000)],
                [
                    make_history(
                        3,
                        first_seen_at_date="2026-05-01T00:00:00Z",
                        last_seen_at_date="2026-05-18T23:59:59Z",
                    )
                ],
            ]
        )

        document = json.loads(stdout)
        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(document["listingCount"], 0)
        self.assertEqual(document["ambiguousCount"], 1)
        self.assertEqual(document["unresolvedCount"], 1)
        self.assertEqual(
            {issue["reason"] for issue in document["issues"]},
            {
                "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE",
            },
        )

    def test_candidate_pagination_failure_withholds_all_evidence(self) -> None:
        responses: list[Any] = []
        total = MARKETCHECK_HISTORICAL_MAX_PAGES * 10 + 1
        for page in range(MARKETCHECK_HISTORICAL_MAX_PAGES):
            responses.append(
                {
                    "num_found": total,
                    "listings": [
                        make_candidate(page * 10 + offset + 1)
                        for offset in range(10)
                    ],
                }
            )

        status, stdout, stderr, transport = self.run_supported(responses)

        document = json.loads(stdout)
        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(document["evidence"], [])
        self.assertIn(
            "PAGINATION_SAFETY_LIMIT_REACHED",
            [issue["reason"] for issue in document["issues"]],
        )
        self.assertEqual(len(transport.calls), MARKETCHECK_HISTORICAL_MAX_PAGES)
        self.assertTrue(
            all(
                call["endpoint"] == MARKETCHECK_PAST_INVENTORY_URL
                for call in transport.calls
            )
        )

    def test_vin_history_pagination_failure_keeps_other_resolved_vin(self) -> None:
        capped = make_candidate(1)
        resolved = make_candidate(2)
        full_pages = [
            [
                make_history(
                    page * MARKETCHECK_VIN_HISTORY_PAGE_SIZE + offset,
                    first_seen_at_date="2026-05-20T00:00:00Z",
                    last_seen_at_date="2026-05-21T00:00:00Z",
                )
                for offset in range(MARKETCHECK_VIN_HISTORY_PAGE_SIZE)
            ]
            for page in range(MARKETCHECK_VIN_HISTORY_MAX_PAGES)
        ]
        status, stdout, stderr, transport = self.run_supported(
            [
                {"num_found": 2, "listings": [capped, resolved]},
                *full_pages,
                [make_history(999)],
            ]
        )

        document = json.loads(stdout)
        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(document["listingCount"], 1)
        scoped = next(
            issue
            for issue in document["issues"]
            if issue["reason"] == "PAGINATION_SAFETY_LIMIT_REACHED"
        )
        self.assertEqual(scoped["vin"], capped["vin"])
        self.assertEqual(
            transport.calls[-1]["endpoint"],
            f"{MARKETCHECK_VIN_HISTORY_URL}/{resolved['vin']}",
        )

    def test_future_date_fails_before_reading_key(self) -> None:
        args = [*self.ELANTRA_ARGS]
        args[1] = "2026-08-11"
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
        ) as read_api_key, redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(args)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("future", stderr.getvalue().lower())
        read_api_key.assert_not_called()

    def test_provider_error_is_nonzero_and_redacts_key(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
            return_value=SYNTHETIC_KEY,
        ), patch.object(
            search_marketcheck_historical,
            "discover_historical_market_evidence",
            side_effect=MarketProviderError(
                f"Provider rejected credential {SYNTHETIC_KEY}"
            ),
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(self.ELANTRA_ARGS)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("[REDACTED]", stderr.getvalue())
        self.assertNotIn(SYNTHETIC_KEY, stderr.getvalue())

    def test_provider_authentication_failure_is_nonzero_and_sanitized(self) -> None:
        failure = HTTPError(
            f"{MARKETCHECK_PAST_INVENTORY_URL}?api_key={SYNTHETIC_KEY}",
            401,
            "unauthorized",
            {},
            None,
        )

        status, stdout, stderr, transport = self.run_supported([failure])

        self.assertEqual(status, 1)
        self.assertEqual(stdout, "")
        self.assertIn("credentials", stderr)
        self.assertNotIn(SYNTHETIC_KEY, stderr)
        self.assertEqual(len(transport.calls), 1)

    def test_transport_error_does_not_print_authenticated_url(self) -> None:
        authenticated_url = (
            f"{MARKETCHECK_PAST_INVENTORY_URL}?api_key={SYNTHETIC_KEY}"
        )
        provider = MarketCheckHistoricalProvider(
            SYNTHETIC_KEY,
            as_of_date=AS_OF_DATE,
            transport=RecordingTransport(
                [URLError(f"could not open {authenticated_url}")]
            ),
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(
            search_marketcheck_historical,
            "_utc_today",
            return_value=AS_OF_DATE,
        ), patch.object(
            search_marketcheck_historical,
            "_read_api_key",
            return_value=SYNTHETIC_KEY,
        ), patch.object(
            search_marketcheck_historical,
            "MarketCheckHistoricalProvider",
            return_value=provider,
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            status = search_marketcheck_historical.main(self.ELANTRA_ARGS)

        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(SYNTHETIC_KEY, stderr.getvalue())
        self.assertNotIn(authenticated_url, stderr.getvalue())

    def test_postal_code_is_required(self) -> None:
        args = self.ELANTRA_ARGS.copy()
        postal_index = args.index("--postal-code")
        del args[postal_index : postal_index + 2]
        stderr = io.StringIO()

        with redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as raised:
                search_marketcheck_historical.parse_args(args)

        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--postal-code", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
