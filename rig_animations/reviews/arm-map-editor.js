/* Source-coordinate annotations only. No image processing or rig mutations. */
(() => {
  'use strict';
  const svg = document.querySelector('svg');
  const overlay = document.querySelector('#overlay');
  const enabled = document.querySelector('#edit-enabled');
  const part = document.querySelector('#part');
  const status = document.querySelector('#edit-status');
  const remove = document.querySelector('#delete-point');
  const undo = document.querySelector('#undo');
  const output = document.querySelector('#draft-json');
  const details = document.querySelector('#draft-details');
  const storageKey = 'wisp-region-map:ARM-01:r02';
  const sourceHash = 'f0c3a98fc8876b3aebbaf9804db8ccd611c2465c6bca49d0171e7bff7fd13cb7';
  const polygons = new Map([...svg.querySelectorAll('[data-part]')].map(node => [node.dataset.part, node]));
  const original = Object.fromEntries([...polygons].map(([id, node]) => [id,
    node.getAttribute('points').trim().split(/\s+/).map(pair => pair.split(',').map(Number))]));
  let regions = structuredClone(original);
  let selected = -1;
  let dragging = false;
  const history = [];
  const handles = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  overlay.append(handles);
  svg.setAttribute('tabindex', '0');

  function documentData() {
    return {format: 'wisp-region-map', revision: 'ARM-01/r02', source_sha256: sourceHash,
      canvas: {width: 1024, height: 1536}, accepted: false, regions,
      proposed_joints: {shoulder: [636, 588], elbow: [704, 756], wrist: [748, 836]}};
  }

  function validDraft(value) {
    return value?.format === 'wisp-region-map' && value.revision === 'ARM-01/r02'
      && value.source_sha256 === sourceHash && value.canvas?.width === 1024
      && value.canvas?.height === 1536 && value.regions
      && Object.keys(value.regions).length === polygons.size
      && [...polygons.keys()].every(id => Array.isArray(value.regions[id])
        && value.regions[id].length >= 3 && value.regions[id].length <= 512
        && value.regions[id].every(point => Array.isArray(point) && point.length === 2
          && point.every(Number.isFinite) && point[0] >= 0 && point[0] <= 1024
          && point[1] >= 0 && point[1] <= 1536));
  }

  function render() {
    for (const [id, node] of polygons) node.setAttribute('points', regions[id].map(p => p.join(',')).join(' '));
    handles.replaceChildren();
    svg.classList.toggle('editing', enabled.checked);
    if (enabled.checked) regions[part.value].forEach(([x, y], index) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', '4');
      circle.setAttribute('class', index === selected ? 'handle selected' : 'handle');
      circle.dataset.index = String(index); handles.append(circle);
    });
    remove.disabled = !enabled.checked || selected < 0 || regions[part.value].length <= 3;
    undo.disabled = history.length === 0;
  }

  function remember() {
    history.push(structuredClone(regions));
    if (history.length > 40) history.shift();
  }

  function changed() {
    status.textContent = 'Есть несохранённые правки. Сохрани черновик перед обновлением страницы.';
    output.value = JSON.stringify(documentData(), null, 2);
    render();
  }

  function position(event) {
    const screenPoint = svg.createSVGPoint();
    screenPoint.x = event.clientX; screenPoint.y = event.clientY;
    const point = screenPoint.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.max(0, Math.min(1024, Math.round(point.x))),
      Math.max(0, Math.min(1536, Math.round(point.y)))];
  }

  function segmentDistance(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
    return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
  }

  enabled.onchange = () => {
    if (enabled.checked) {
      overlay.style.display = '';
      document.querySelector('#toggle').setAttribute('aria-pressed', 'true');
      document.querySelector('#toggle').textContent = 'Скрыть разметку';
    }
    selected = -1; render();
  };
  part.onchange = () => { selected = -1; render(); };
  svg.addEventListener('pointerdown', event => {
    if (!enabled.checked || !event.target.classList.contains('handle')) return;
    event.preventDefault(); svg.focus({preventScroll: true});
    selected = Number(event.target.dataset.index);
    remember(); dragging = true; svg.setPointerCapture(event.pointerId); render();
  });
  svg.addEventListener('pointermove', event => {
    if (!dragging) return;
    regions[part.value][selected] = position(event); changed();
  });
  function stopDragging() { dragging = false; }
  svg.addEventListener('pointerup', stopDragging);
  svg.addEventListener('pointercancel', stopDragging);
  svg.addEventListener('dblclick', event => {
    if (!enabled.checked || event.target.classList.contains('handle')) return;
    event.preventDefault();
    const points = regions[part.value];
    if (points.length >= 512) return;
    const point = position(event);
    let closest = 0, distance = Infinity;
    points.forEach((a, index) => {
      const candidate = segmentDistance(point, a, points[(index + 1) % points.length]);
      if (candidate < distance) { distance = candidate; closest = index; }
    });
    remember(); selected = closest + 1; points.splice(selected, 0, point); changed();
  });
  remove.onclick = () => {
    if (remove.disabled) return;
    remember(); regions[part.value].splice(selected, 1); selected = -1; changed();
  };
  svg.addEventListener('keydown', event => {
    if (event.key === 'Delete' && !remove.disabled) { event.preventDefault(); remove.click(); }
  });
  undo.onclick = () => { if (history.length) { regions = history.pop(); selected = -1; changed(); } };
  document.querySelector('#reset-part').onclick = () => {
    remember(); regions[part.value] = structuredClone(original[part.value]); selected = -1; changed();
  };
  document.querySelector('#save-draft').onclick = () => {
    const data = {...documentData(), saved_at: new Date().toISOString()};
    output.value = JSON.stringify(data, null, 2); details.open = true;
    try {
      localStorage.setItem(storageKey, output.value);
      status.textContent = 'Черновик сохранён в этом браузере. Приёмка ещё не выполнена.';
    } catch {
      status.textContent = 'Браузер не сохранил черновик. Скачай JSON или скопируй координаты ниже.';
    }
  };
  document.querySelector('#download-draft').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(documentData(), null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'ARM-01-r02-draft.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const value = JSON.parse(saved);
      if (validDraft(value)) {
        regions = value.regions; output.value = saved; details.open = true;
        status.textContent = 'Восстановлен твой браузерный черновик r02. Приёмка ещё не выполнена.';
      } else status.textContent = 'Найден несовместимый черновик; он не изменён. Показана исходная карта r02.';
    }
  } catch { status.textContent = 'Браузерный черновик недоступен. Можно работать и скачать JSON.'; }
  if (!output.value) output.value = JSON.stringify(documentData(), null, 2);
  render();
})();
