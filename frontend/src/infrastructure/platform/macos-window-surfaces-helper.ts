/** Fixed JXA source: metadata only; no Apple Events, AX, titles or capture APIs. */
export const MACOS_WINDOW_SURFACES_HELPER = String.raw`
ObjC.import('Foundation');
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.bindFunction('CGWindowListCopyWindowInfo', ['void *', ['unsigned int', 'unsigned int']]);
ObjC.bindFunction('CFRelease', ['void', ['void *']]);
var tokens = Object.create(null);
var lastRequest = 0;
function integer(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
function sample(request) {
  if (!/^[1-9][0-9]* [1-9][0-9]*(,[1-9][0-9]*)*$/.test(request)) throw Error('Invalid request');
  var parts = request.split(' '), requestId = Number(parts[0]), own = parts[1].split(',').map(Number);
  if (!integer(requestId) || requestId <= lastRequest || requestId > 9007199254740991 || own.length > 512) throw Error('Invalid request');
  lastRequest = requestId;
  own.push(Number($.NSProcessInfo.processInfo.processIdentifier));
  var copied = $.CGWindowListCopyWindowInfo(1 | 16, 0);
  if (!copied) throw Error('Window server unavailable');
  var list = ObjC.castRefToObject(copied);
  if (list.isNil()) throw Error('Window server unavailable');
  try {
  var count = Number(list.count), windows = [];
  if (!integer(count) || count < 0 || count > 4096) throw Error('Invalid enumeration');
  for (var index = 0; index < count; index++) {
    var record = list.objectAtIndex(index), selected = {};
    ['kCGWindowNumber', 'kCGWindowOwnerPID', 'kCGWindowAlpha', 'kCGWindowLayer', 'kCGWindowBounds'].forEach(function(key) {
      selected[key] = ObjC.deepUnwrap(record.objectForKey($(key)));
    });
    windows.push(selected);
  }
  } finally { $.CFRelease(copied); }
  var above = [], rows = [], accepted = Object.create(null), seen = Object.create(null);
  windows.forEach(function(w) {
    var id = w.kCGWindowNumber, pid = w.kCGWindowOwnerPID, alpha = w.kCGWindowAlpha, layer = w.kCGWindowLayer;
    if (!integer(id) || id <= 0 || !integer(pid) || pid <= 0 || !integer(layer)
        || typeof alpha !== 'number' || !isFinite(alpha) || alpha < 0 || alpha > 1) throw Error('Invalid metadata');
    var key = id + ':' + pid;
    if (seen[key]) throw Error('Duplicate window');
    seen[key] = true;
    if (own.indexOf(pid) >= 0 || alpha === 0) return;
    var b = w.kCGWindowBounds;
    if (!b || !['X', 'Y', 'Width', 'Height'].every(function(k) {
      return typeof b[k] === 'number' && isFinite(b[k]) && Math.abs(b[k]) <= 10000000;
    }) || b.Width < 0 || b.Height < 0) throw Error('Unknown geometry');
    if (b.Width === 0 || b.Height === 0) return;
    var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    var regular = !app.isNil() && Number(app.activationPolicy) === 0;
    if (layer === 0 && alpha === 1 && regular) {
      var top = true, left = true, right = true;
      above.forEach(function(a) {
        top = top && !(a.X <= b.X + b.Width && a.X + a.Width >= b.X && a.Y <= b.Y && a.Y + a.Height >= b.Y);
        left = left && !(a.X <= b.X && a.X + a.Width >= b.X && a.Y <= b.Y + b.Height && a.Y + a.Height >= b.Y);
        right = right && !(a.X <= b.X + b.Width && a.X + a.Width >= b.X + b.Width && a.Y <= b.Y + b.Height && a.Y + a.Height >= b.Y);
      });
      if (top || left || right) {
        var token = tokens[key] || ObjC.unwrap($.NSUUID.UUID.UUIDString).replace(/-/g, '').toLowerCase();
        accepted[key] = token;
        rows.push({ token: token, x: b.X, y: b.Y, width: b.Width, height: b.Height, top: top, left: left, right: right });
        if (rows.length > 512) throw Error('Snapshot too large');
      }
    }
    above.push(b);
  });
  tokens = accepted;
  return { requestId: requestId, windows: rows };
}
function run() {
  var input = $.NSFileHandle.fileHandleWithStandardInput, output = $.NSFileHandle.fileHandleWithStandardOutput;
  function write(value) {
    var text = JSON.stringify(value) + '\n';
    if (text.length > 262143) throw Error('Snapshot too large');
    output.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));
  }
  write({ ready: true });
  var pending = '';
  while (true) {
    var pool = $.NSAutoreleasePool.alloc.init;
    try {
    var data = input.availableData;
    if (Number(data.length) === 0) return;
    if (Number(data.length) > 8192) throw Error('Request too large');
    var text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    if (text.isNil()) throw Error('Invalid encoding');
    pending += ObjC.unwrap(text);
    if (pending.length > 8192) throw Error('Request too large');
    var end;
    while ((end = pending.indexOf('\n')) >= 0) {
      var request = pending.slice(0, end); pending = pending.slice(end + 1);
      write(sample(request));
    }
    } finally { pool.drain; }
  }
}
`;
