(function () {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const statusEl = document.getElementById('contactStatus');

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
  }

  async function tryApiSubmit(payload) {
    // Same-origin API endpoint (works if you deploy backend with a reverse proxy or serve API from same domain).
    const url = `${window.location.origin}/api/contact`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch { /* ignore */ }
      throw new Error(bodyText || `HTTP ${res.status}`);
    }

    return res.json().catch(() => ({}));
  }

  function fallbackMailto(payload) {
    const to = 'info@furrow.studio';
    const subject = encodeURIComponent(`Website inquiry from ${payload.name || 'Visitor'}`);
    const body = encodeURIComponent(
      `Name: ${payload.name || ''}\nEmail: ${payload.email || ''}\n\nMessage:\n${payload.message || ''}\n\nPage: ${payload.page || ''}`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Sending...');

    const payload = {
      name: String(form.elements.namedItem('name')?.value || '').trim(),
      email: String(form.elements.namedItem('email')?.value || '').trim(),
      message: String(form.elements.namedItem('message')?.value || '').trim(),
      page: window.location.href,
      ts: new Date().toISOString()
    };

    if (!payload.message) {
      setStatus('Please enter a message.');
      return;
    }

    try {
      await tryApiSubmit(payload);
      setStatus('Message sent. We will get back to you soon.');
      form.reset();
    } catch (err) {
      // If API is not deployed, fall back to opening the user’s email client.
      setStatus('Opening email app...');
      fallbackMailto(payload);
      setTimeout(() => setStatus(''), 2000);
    }
  });
})();
