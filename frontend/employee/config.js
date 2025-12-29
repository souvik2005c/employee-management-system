(() => {
	try {
		// If the deployer already set it, don't overwrite.
		if (typeof window.__EMS_API_URL__ === 'string' && window.__EMS_API_URL__.trim()) return;

		const loc = window.location;
		const protocol = String(loc.protocol || '');
		const hostname = String(loc.hostname || '').trim();
		const pathname = String(loc.pathname || '');

		// Local dev
		const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
		if (isLocalHost) {
			window.__EMS_API_URL__ = 'http://localhost:3000';
			return;
		}

		// If UI is being served by the backend under /ui, the API is same-origin.
		if (pathname === '/ui' || pathname.startsWith('/ui/')) {
			window.__EMS_API_URL__ = String(loc.origin || (protocol + '//' + hostname));
			return;
		}

		// VS Code dev tunnels (common pattern): <name>-5173.<domain> -> <name>-3000.<domain>
		if (hostname.includes('devtunnels.ms')) {
			const suffix = hostname.match(/^(.*)-(\d+)(\..*)$/);
			if (suffix) {
				window.__EMS_API_URL__ = `${protocol}//${suffix[1]}-3000${suffix[3]}`;
				return;
			}
			const prefix = hostname.match(/^(\d+)-(.*)$/);
			if (prefix) {
				window.__EMS_API_URL__ = `${protocol}//3000-${prefix[2]}`;
				return;
			}
		}

		// Default for separate frontend hosting (Vercel): point to Render backend.
		window.__EMS_API_URL__ = 'https://employee-management-system-ng3s.onrender.com';
	} catch {
		window.__EMS_API_URL__ = 'https://employee-management-system-ng3s.onrender.com';
	}
})();
