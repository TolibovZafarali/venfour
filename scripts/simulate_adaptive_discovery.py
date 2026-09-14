"""Print deterministic fictional request allocations with all network blocked."""

import json
import os
from pathlib import Path
import sys


def main() -> int:
    os.environ.clear()
    os.environ.update({"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
    sys.dont_write_bytecode = True
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from scripts.run_offline_tests import OfflineNetworkGuard

    guard = OfflineNetworkGuard()
    guard.install()
    guard.check()
    from tests.test_adaptive_discovery_coverage import CANARY_POLICY, SCENARIOS, scenario_report

    results = [scenario_report(name) for name in SCENARIOS]
    print(json.dumps({
        "evidenceType": "SYNTHETIC_OFFLINE_SIMULATION",
        "limitation": "Fictional inventory demonstrates deterministic decisions; yields do not predict live inventory.",
        "policy": CANARY_POLICY.to_dict(), "requestedDiscoveryPageSize": 50,
        "maximumDiscoveryPagesPerCenter": 2,
        "unexpectedNetworkAttempts": len(guard.violations), "blockedGuardProbes": guard.expected_probes,
        "scenarios": results,
    }, indent=2))
    return 1 if guard.violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
