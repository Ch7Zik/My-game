"""Package the already built Yandex Games variant without shipping source files."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


DIST = Path('dist')
ARCHIVE = Path('release/puzzles-yandex-games.zip')
LIMIT = 100 * 1024 * 1024

if not (DIST / 'index.html').is_file():
    raise SystemExit('Run npm run build:yandex first: dist/index.html is missing')

files = sorted(path for path in DIST.rglob('*') if path.is_file())
names = [path.relative_to(DIST).as_posix() for path in files]
if not files or not all(name.isascii() and ' ' not in name for name in names):
    raise SystemExit('Release files must have ASCII names without spaces')
if any(name.startswith(('docs/', 'tests/', 'src/')) for name in names):
    raise SystemExit('Source, documentation or tests found in dist')
if any('/source/' in name or name.lower().endswith(('.png', '.jpg', '.jpeg')) for name in names):
    raise SystemExit('Source artwork or screenshots found in dist')
if not any('/sdk.js' in path.read_text(encoding='utf-8') for path in files if path.suffix == '.js'):
    raise SystemExit('This is not the Yandex build: SDK loader is absent')

unpacked = sum(path.stat().st_size for path in files)
if unpacked >= LIMIT:
    raise SystemExit(f'Unpacked release exceeds the 100 MiB safeguard: {unpacked} bytes')

ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(ARCHIVE, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for file, name in zip(files, names):
        archive.write(file, name)

with ZipFile(ARCHIVE) as archive:
    if 'index.html' not in archive.namelist() or archive.testzip() is not None:
        raise SystemExit('Release archive failed index or CRC validation')

print(f'{ARCHIVE}: {ARCHIVE.stat().st_size} bytes ZIP, {unpacked} bytes unpacked, {len(files)} files')
