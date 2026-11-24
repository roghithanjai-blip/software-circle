// diag.js: classic script (not a module) so it still runs when a module fails. Shows startup errors on the page instead of a blank screen.
(function () {
  function show(msg) {
    var box = document.getElementById('fatal');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'fatal';
      box.style.cssText = 'margin:24px;padding:16px;border:1px solid #ff7a7a;border-radius:10px;background:#1b1020;color:#ffd0d0;font:13px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;position:relative;z-index:99';
      document.body.appendChild(box);
    }
    box.textContent += (box.textContent ? '\n\n' : 'Startup problem:\n') + msg;
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) show('Could not load: ' + (t.src || t.href) + '\nCheck the file exists at that path.');
    else show(e.message + (e.filename ? '\n(' + e.filename.split('/').slice(-2).join('/') + ':' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    show(String((e.reason && e.reason.message) || e.reason));
  });
})();
