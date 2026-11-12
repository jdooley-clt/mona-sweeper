(() => {
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    const saved = localStorage.getItem('mona-sweeper-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch { /* storage unavailable */ }
  document.documentElement.dataset.theme = theme;
})();
