"""Verify portable approved assets, layouts and local documentation links (stdlib)."""
import hashlib
import json
from pathlib import Path
import re
import struct
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def verify(root=ROOT):
    record = json.loads((root / 'references/accepted-files.json').read_text())
    for name, expected in record['files'].items():
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or linked asset: {name}')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected['sha256']:
            raise ValueError(f'Asset changed: {name}')
    for layout in root.glob('work/**/layout.json'):
        data = json.loads(layout.read_text())
        for layer in data['layers']:
            source = layer['image']
            png = layout.parent / source['path']
            header = png.read_bytes()[:24]
            if header[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError(f'Invalid PNG: {png}')
            dimensions = struct.unpack('>II', header[16:24])
            if dimensions != (source['width'], source['height']):
                raise ValueError(f'Layout dimensions differ: {png}')
    for document in [root / 'README.md', root / 'HANDOFF.md', *root.glob('docs/*.md'), *root.glob('reviews/*.html')]:
        text = document.read_text()
        links = re.findall(r'\]\(([^)]+)\)', text) if document.suffix == '.md' else re.findall(r'(?:href|src)="([^"]+)"', text)
        for link in links:
            if re.match(r'(?:https?:|#|data:)', link) or '${' in link:
                continue
            target = unquote(link.split('#')[0])
            if not (document.parent / target).exists():
                raise ValueError(f'Broken local link in {document.name}: {link}')
    for approval in root.glob('reviews/*acceptance.json'):
        for name, digest in json.loads(approval.read_text()).get('sha256', {}).items():
            if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
                raise ValueError(f'Acceptance hash differs: {name}')
    print(f'OK: {len(record["files"])} retained assets, Layout PNGs, approval hashes and local links')


if __name__ == '__main__':
    verify()
