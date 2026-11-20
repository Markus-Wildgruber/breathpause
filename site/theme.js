// Light/dark switch for the site. Loaded in <head> (not deferred) so a saved choice is applied
// before the page paints. No saved choice = follow the system (style.css's media query).
(function () {
  var KEY = 'breathpause-theme';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  var current = function () {
    return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  };
  var mark = function () {
    document.querySelectorAll('.theme button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.set === current()));
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.theme button').forEach(function (b) {
      b.addEventListener('click', function () {
        root.dataset.theme = b.dataset.set;
        try { localStorage.setItem(KEY, b.dataset.set); } catch (e) {}
        mark();
      });
    });
    mark();
    // Following the system: keep the switch in step when the system theme changes.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', mark);
  });
})();
