"""Run all database suites against an explicitly network-isolated local container."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', required=True)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('files', nargs='*')
args = parser.parse_args()
if not re.fullmatch(r'venfour-migration-rehearsal[-a-z0-9]*', args.container):
    raise ValueError('Only dedicated rehearsal containers are allowed')
mode = subprocess.check_output(['docker','inspect',args.container,'--format','{{.HostConfig.NetworkMode}}'],text=True).strip()
assert mode == 'none'
root = Path(__file__).resolve().parents[1]
args.output.mkdir(parents=True, exist_ok=True)
files = [root / p for p in args.files] if args.files else sorted((root/'supabase/tests/database').glob('*.test.sql'))
results=[]
for path in files:
    result = subprocess.run(['docker','exec','-i',args.container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt','-f','-'],
                            input=path.read_text(),text=True,capture_output=True)
    text = result.stdout + result.stderr
    (args.output / (path.name+'.log')).write_text(text)
    tests = re.findall(r'^(?:not )?ok \d+\b.*',result.stdout,re.M)
    failures = re.findall(r'^not ok \d+\b.*',result.stdout,re.M)
    plans = re.findall(r'^1\.\.(\d+)\s*$',result.stdout,re.M)
    success = result.returncode == 0 and not failures and len(plans)==1 and int(plans[0])==len(tests)
    row = {'file':path.name,'assertions':len(tests),'success':success,'failures':failures,'exit_code':result.returncode}
    results.append(row)
    print(json.dumps(row),flush=True)
    if result.returncode: print(result.stderr[-2500:],flush=True)
(args.output/'database-test-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'files':len(results),'assertions':sum(r['assertions'] for r in results),'failed_files':sum(not r['success'] for r in results)}))
sys.exit(0 if all(r['success'] for r in results) else 1)
