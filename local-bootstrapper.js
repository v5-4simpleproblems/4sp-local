(function() {
    // UPDATED VERSION
    const CDN_BASE = 'https://cdn.jsdelivr.net/npm/4sp-local-client@1.0.2';
    
    // Helper: Fix relative URLs in HTML content
    function fixRelativeUrls(html) {
        // Fix src attributes (scripts, images)
        html = html.replace(/(src=['"])(?!http|\/\/|data:)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
            const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
            return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
        });
        
        // Fix href attributes (css, links) - EXCLUDE anchor links #
        html = html.replace(/(href=['"])(?!http|\/\/|data:|#)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
             const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
             return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
        });

        // NEW: Fix Module Imports (CORS Fix for file://)
        // Looks for: import ... from "./..." or "../..."
        html = html.replace(/(from\s+['"])(?!http|\/\/)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
             const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
             return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
        });
        
        return html;
    }

    // NEW: Sequential Script Loader (Fixes Tailwind Race Condition)
    async function runScripts(container) {
        const scripts = Array.from(container.querySelectorAll('script'));
        
        for (const oldScript of scripts) {
            const newScript = document.createElement('script');
            
            // Copy attributes
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            
            // Fix src if needed (regex usually catches this, but double check)
            if (newScript.src && !newScript.src.startsWith('http') && !newScript.src.startsWith('data:')) {
                const relative = newScript.getAttribute('src').replace(/^(\.\/|\.\.\/)+/, '');
                newScript.src = `${CDN_BASE}/${relative}`;
            }

            // Copy inline content with import fix
            if (oldScript.innerHTML) {
                // Also fix imports inside inline scripts if regex missed them
                let content = oldScript.innerHTML;
                content = content.replace(/(from\s+['"])(?!http|\/\/)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
                     const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
                     return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
                });
                // Also fix dynamic imports import(...)
                content = content.replace(/(import\s*\(['"])(?!http|\/\/)([^'"]+)(['"]\))/g, (match, prefix, url, suffix) => {
                     const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
                     return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
                });
                newScript.innerHTML = content;
            }
            
            // EXECUTION
            oldScript.remove(); // Remove old placeholder
            
            // If it has src, we must wait for it to load
            if (newScript.src) {
                await new Promise((resolve, reject) => {
                    newScript.onload = resolve;
                    newScript.onerror = resolve; // Continue even if error
                    container.appendChild(newScript);
                });
            } else {
                // Inline script: just append and it runs synchronously
                container.appendChild(newScript);
            }
        }
    }
    
    // Main Loader
    async function loadPage(pagePath) {
        try {
            document.body.innerHTML = '<div style="color:gray; padding:20px;">Loading...</div>';

            const response = await fetch(`${CDN_BASE}/${pagePath}`);
            if (!response.ok) throw new Error(`Failed to load ${pagePath}`);
            
            let html = await response.text();
            
            // 1. Fix URLs before injection
            html = fixRelativeUrls(html);
            
            // 2. Parse HTML to extract Head and Body
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // 3. Replace HEAD
            // We append new head content, but filter out duplicates if needed?
            // Actually, for Tailwind, it might need clean slate. 
            // Let's clear head of styles/scripts from previous page? 
            // Be careful not to kill the bootstrapper itself if it had styles.
            // But bootstrapper is JS only.
            
            // NEW strategy: Clear old page-specific assets?
            // For now, just append. Browser handles duplicate CSS gracefully usually.
            // But we must run HEAD scripts (like Tailwind CDN) using our sequential runner.
            
            // 4. Set Body Content
            document.body.innerHTML = doc.body.innerHTML;
            document.body.className = doc.body.className;
            
            // 5. Execute Scripts Sequentially
            // We create a temporary container for head scripts to execute them
            // actually, we can just append them to document.head
            await runScripts(doc.head); // Run head scripts (like Tailwind CDN)
            await runScripts(document.body); // Run body scripts
            
        } catch (e) {
            document.body.innerHTML = `<div style="color:red; padding:20px;">
                <h3>Error loading app</h3>
                <p>${e.message}</p>
                <p><small>Version: ${CDN_BASE}</small></p>
            </div>`;
        }
    }

    function init() {
        const uid = localStorage.getItem('4sp_uid');
        if (uid) {
            loadPage('logged-in/dashboard.html');
        } else {
            loadPage('authentication.html');
        }
    }

    // Handle internal redirects
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link) {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto')) {
                e.preventDefault();
                if (href.includes('dashboard')) {
                    if(localStorage.getItem('4sp_uid')) loadPage('logged-in/dashboard.html');
                } else if (href.includes('settings')) {
                    loadPage('logged-in/settings.html');
                } else if (href.includes('authentication') || href.includes('logout')) {
                    loadPage('authentication.html');
                } else {
                    // Fallback: try to load the relative path from CDN
                    const cleanPath = href.replace(/^(\.\/|\.\.\/)+/, '');
                    loadPage(cleanPath);
                }
            }
        }
    });
    
    window.localRedirect = (path) => {
        if (path.includes('index.html') || path.includes('authentication.html')) {
             loadPage('authentication.html');
        } else if (path.includes('dashboard.html')) {
             loadPage('logged-in/dashboard.html');
        }
    };
    
    init();

})();