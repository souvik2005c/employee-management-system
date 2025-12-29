(function () {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    const prefersDark = (() => {
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch {
            return false;
        }
    })();

    const saved = (localStorage.getItem('theme') || '').trim();
    const initialMode = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');

    document.body.classList.toggle('dark-mode', initialMode === 'dark');
    toggle.checked = initialMode === 'dark';

    toggle.addEventListener('change', () => {
        const mode = toggle.checked ? 'dark' : 'light';
        localStorage.setItem('theme', mode);
        document.body.classList.toggle('dark-mode', mode === 'dark');
    });
})();
