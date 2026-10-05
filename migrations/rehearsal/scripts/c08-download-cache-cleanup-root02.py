"""Run only after explicit approval; removes an allowlisted stale public CLI cache."""
import json
import os
import shutil
import stat
import sys

ACTIVE = '/tmp/tmpyp4nzruy'
CANDIDATES = ['tmpmg4ny2pw', 'tmpk10bnejz', 'tmp86sbzzrl', 'tmp8c487s79', 'tmpdbcaj32q']
ROOT_CONTENTS = {'amd64', 'arm64', 'ppc64le', 's390x', 'index.html', 'oc-license'}
REGULAR_FILES = {'index.html', 'oc.tar', 'oc.zip', 'oc.rhel8.tar', 'oc.rhel8.zip', 'oc.rhel9.tar', 'oc.rhel9.zip'}
LINK_TARGETS = {
    '/usr/share/openshift/LICENSE',
    '/usr/share/openshift/windows/oc.exe',
    '/usr/share/openshift/mac/oc',
    '/usr/share/openshift/mac_arm64/oc',
    *['/usr/share/openshift/' + platform + '/' + binary
      for platform in ['linux_amd64', 'linux_arm64', 'linux_ppc64le', 'linux_s390x']
      for binary in ['oc', 'oc.rhel8', 'oc.rhel9']],
}
PLATFORMS = {'amd64': ['linux', 'mac', 'windows'], 'arm64': ['linux', 'mac'], 'ppc64le': ['linux'], 's390x': ['linux']}
DIRECTORY_PATHS = set(PLATFORMS) | {arch + '/' + system for arch, systems in PLATFORMS.items() for system in systems}
REGULAR_PATHS = {'index.html'} | {directory + '/index.html' for directory in DIRECTORY_PATHS}
LINK_PATHS = {'oc-license': '/usr/share/openshift/LICENSE'}
for arch, systems in PLATFORMS.items():
    for system in systems:
        prefix = arch + '/' + system + '/'
        binaries = ['oc', 'oc.rhel8', 'oc.rhel9'] if system == 'linux' else ['oc.exe' if system == 'windows' else 'oc']
        source = 'linux_' + arch if system == 'linux' else 'mac_arm64' if arch == 'arm64' else system
        for binary in binaries:
            LINK_PATHS[prefix + binary] = '/usr/share/openshift/' + source + '/' + binary
            archive = binary.removesuffix('.exe')
            REGULAR_PATHS.update({prefix + archive + '.tar', prefix + archive + '.zip'})

def identity():
    assert os.path.realpath('/proc/1/cwd') == ACTIVE, 'active server cache changed'
    assert b'python3\0/tmp/serve.py' in open('/proc/1/cmdline', 'rb').read(), 'server identity changed'
    return open('/proc/1/stat').read().split(') ', 1)[1].split()[19]

def validate(name):
    path = '/tmp/' + name
    assert name in CANDIDATES and not os.path.islink(path), 'cache path refused'
    assert os.path.realpath(path) == path and os.path.dirname(path) == '/tmp', 'cache scope refused'
    assert path != ACTIVE and set(os.listdir(path)) == ROOT_CONTENTS, 'cache contents changed'
    size = 0
    for root, directories, files in os.walk(path, followlinks=False):
        assert not os.path.ismount(root), 'nested mount refused'
        assert os.stat(root).st_dev == os.stat('/tmp').st_dev, 'different filesystem refused'
        for directory in directories:
            assert not os.path.islink(os.path.join(root, directory)), 'symlink directory refused'
            assert os.path.relpath(os.path.join(root, directory), path) in DIRECTORY_PATHS, 'unexpected subtree refused'
        for name in files:
            entry = os.path.join(root, name)
            relative = os.path.relpath(entry, path)
            metadata = os.lstat(entry)
            if stat.S_ISLNK(metadata.st_mode):
                assert os.readlink(entry) in LINK_TARGETS, 'unexpected link refused'
                assert LINK_PATHS.get(relative) == os.readlink(entry), 'unexpected relative link path refused'
            else:
                assert stat.S_ISREG(metadata.st_mode) and name in REGULAR_FILES and relative in REGULAR_PATHS, 'unexpected file refused'
                size += metadata.st_size
    for descriptor in os.listdir('/proc/1/fd'):
        try:
            assert not os.readlink('/proc/1/fd/' + descriptor).startswith(path + '/'), 'server uses stale cache'
        except FileNotFoundError:
            pass
    return path, size

assert shutil.rmtree.avoids_symlink_attacks, 'safe recursive removal unavailable'
instance = identity()
selected = CANDIDATES if sys.argv[1] == 'validate' else CANDIDATES[:1] if sys.argv[1] == 'first' else CANDIDATES[1:] if sys.argv[1] == 'remaining' else []
assert selected, 'mode refused'
validated = [validate(name) for name in selected]
print(json.dumps({'validated': [{'name': os.path.basename(p), 'bytes': size} for p, size in validated], 'activePreserved': ACTIVE}), flush=True)
for path, size in validated:
    assert identity() == instance, 'server restarted'
    validate(os.path.basename(path))
    if sys.argv[1] == 'validate':
        continue
    shutil.rmtree(path)
    print(json.dumps({'removed': os.path.basename(path), 'bytes': size}), flush=True)
assert identity() == instance, 'server restarted after cleanup'
