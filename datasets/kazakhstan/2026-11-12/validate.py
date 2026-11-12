"""Validate the published snapshot without network access or target execution."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


repos = read('repositories.json')
findings = read('findings.json')
summary = read('summary.json')
technologies = read('technologies.json')
assert len(repos) == summary['uniqueRepositories'] == 635
assert len({r['repo'].casefold() for r in repos}) == len(repos)
ids = [str(r['githubId']) for r in repos if r['githubId']]
assert len(ids) == len(set(ids))
assert all(r['status'] == 'scanned' for r in repos)
assert sum(r['emptyRepository'] for r in repos) == 4
assert summary['pendingRepositories'] == 0
assert len(findings) == summary['automaticFindings'] == 13867
assert dict(collections.Counter(f['visibility'] for f in findings)) == summary['visibility']
by_name = {r['repo'].casefold(): r for r in repos}
for f in findings:
    assert f['repo'].casefold() in by_name
    assert f['sha'] == by_name[f['repo'].casefold()]['sha']
    assert not {'evidence', 'detail'} & f.keys()
    if f['scanner'] == 'secrets':
        assert f['title'] == 'Potential secret; value and evidence omitted; validity untested'
assert sum(t['repositories'] for t in technologies) == 635
assert sum(t['notScanned'] for t in technologies) == 0
assert {t['technology']: t['repositories'] for t in technologies} == dict(
    collections.Counter(r['primaryTechnology'] for r in repos)
)
for r in repos:
    assert (len(r['sha']) == 40) != r['emptyRepository']
assert len(read('companies/companies-169.json')) == 169
assert len(read('companies/preliminary-100.json')) == 100
assert len(read('companies/previous-80.json')) == 80
print('Validated: 635 repositories, 13,867 signals, 4 empty repositories, 0 pending.')
