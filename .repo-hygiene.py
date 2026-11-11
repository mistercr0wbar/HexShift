#!/usr/bin/env python3
"""Check repository content, including the index and outgoing commit trees.

No dependencies or network. Keep repository copies identical to this source.
"""
import argparse
import fnmatch
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

POLICY = '.repo-hygiene.json'
DOC_SUFFIXES = {'.md', '.markdown', '.mdx', '.txt', '.rst', '.adoc', '.pdf', '.doc', '.docx', '.odt', '.rtf'}


def git(*args, cwd=None):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, check=True).stdout


def violations(paths, policy):
    if policy.get('version') != 1:
        raise ValueError('unsupported policy version')
    allowed_docs = set(policy['documents'])
    exceptions = set(policy.get('allowed_artifacts', []))
    for name in paths:
        if name in exceptions:
            continue
        if any(fnmatch.fnmatchcase(name.lower(), pattern.lower())
               for pattern in policy['forbidden']):
            yield name, 'disposable output or local state'
        elif PurePosixPath(name).suffix.lower() in DOC_SUFFIXES and name not in allowed_docs:
            yield name, 'document not approved in ' + POLICY


def check(root, mode, ref=None):
    if mode == 'working-tree':
        paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', cwd=root)
        paths = [p for p in paths.decode().split('\0') if p and (root / p).exists()]
        policy = json.loads((root / POLICY).read_text())
    elif mode == 'staged':
        paths = git('ls-files', '-z', cwd=root).decode().split('\0')
        policy = json.loads(git('show', ':' + POLICY, cwd=root))
    else:
        paths = git('ls-tree', '-rz', '--name-only', ref, cwd=root).decode().split('\0')
        policy = json.loads(git('show', ref + ':' + POLICY, cwd=root))
    errors = list(violations(filter(None, paths), policy))
    for path, reason in errors:
        print(f'{path}: {reason}', file=sys.stderr)
    return not errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--staged', action='store_true')
    modes.add_argument('--tracked', action='store_true', help='check the complete index')
    modes.add_argument('--working-tree', action='store_true', help='also check visible untracked files')
    modes.add_argument('--ref', help='check a committed tree')
    modes.add_argument('--pre-push', action='store_true')
    parser.add_argument('--remote', default='origin')
    args = parser.parse_args(argv)
    root = Path(git('rev-parse', '--show-toplevel').decode().strip())
    try:
        if args.pre_push:
            refs = set()
            for line in sys.stdin:
                _, local_sha, _, _ = line.split()
                if set(local_sha) == {'0'}:
                    continue
                refs.add(local_sha)
                refs.update(git('rev-list', local_sha, '--not', '--remotes=' + args.remote,
                                cwd=root).decode().splitlines())
            return 0 if all([check(root, 'ref', ref) for ref in sorted(refs)]) else 1
        mode = 'working-tree' if args.working_tree else 'ref' if args.ref else 'staged'
        return 0 if check(root, mode, args.ref) else 1
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        print(f'Repository hygiene could not be verified: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
