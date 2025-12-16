
(function() {
    const CDN_BASE = 'https://cdn.jsdelivr.net/npm/4sp-local-client@1.0.0';
    
    // Helper: Fix relative URLs in HTML content
    function fixRelativeUrls(html) {
        // Fix src attributes (scripts, images)
        html = html.replace(/(src=['"])(?!http|\/\/|data:)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
            // Remove leading ./ or ../
            const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
            return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
        });
        
        // Fix href attributes (css, links) - EXCLUDE anchor links #
        html = html.replace(/(href=['"])(?!http|\/\/|data:|#)([^'"]+)(['"])/g, (match, prefix, url, suffix) => {
             const cleanUrl = url.replace(/^(\.\/|\.\.\/)+/, '');
             return `${prefix}${CDN_BASE}/${cleanUrl}${suffix}`;
        });
        
        return html;
    }

    // Helper: Manually execute scripts from injected HTML
    function runScripts(container) {
        const scripts = container.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            // Copy attributes
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            
            // Fix src if it exists (it might have been missed by regex if dynamically created, but regex covers HTML string)
            if (newScript.src && !newScript.src.startsWith('http') && !newScript.src.startsWith('data:')) {
                // The regex above should have caught this, but double check
                const relative = newScript.getAttribute('src').replace(/^(\.\/|\.\.\/)+/, '');
                newScript.src = `${CDN_BASE}/${relative}`;
            }

            // Copy content
            if (oldScript.innerHTML) newScript.innerHTML = oldScript.innerHTML;
            
            // Execute
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }
    
    // Main Loader
    async function loadPage(pagePath) {
        try {
            const response = await fetch(`${CDN_BASE}/${pagePath}`);
            if (!response.ok) throw new Error(`Failed to load ${pagePath}`);
            
            let html = await response.text();
            
            // 1. Fix URLs before injection
            html = fixRelativeUrls(html);
            
            // 2. Parse HTML to extract Head and Body
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // 3. Replace HEAD (merging styles/scripts)
            // We clear existing head content that isn't essential? 
            // Better: Append new head content.
            const newHeadNodes = Array.from(doc.head.childNodes);
            newHeadNodes.forEach(node => {
                 // Check if it's a script to run manually? 
                 // No, head scripts usually load resources.
                 // We need to clone them to make them execute/apply.
                 const newNode = document.importNode(node, true);
                 document.head.appendChild(newNode);
            });

            // 4. Replace BODY
            document.body.innerHTML = doc.body.innerHTML;
            document.body.className = doc.body.className; // Copy classes
            
            // 5. Execute Scripts in Body
            runScripts(document.body);
            // Also need to execute scripts that were appended to Head?
            // importNode on script tags might not execute them.
            runScripts(document.head);
            
        } catch (e) {
            document.body.innerHTML = `<div style="color:red; padding:20px;">Error loading app: ${e.message}</div>`;
        }
    }

    // Router Logic
    function init() {
        const uid = localStorage.getItem('4sp_uid');
        if (uid) {
            // Logged In -> Dashboard
            loadPage('logged-in/dashboard.html');
        } else {
            // Logged Out -> Auth (Link Device)
            loadPage('authentication.html');
        }
    }

    // Handle internal redirects (naive implementation)
    // We override window.location.href setters? No, that's hard.
    // We can listen for clicks on links.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link) {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#')) {
                e.preventDefault();
                // Map relative paths to our virtual router
                // simplified:
                if (href.includes('dashboard')) {
                    if(localStorage.getItem('4sp_uid')) loadPage('logged-in/dashboard.html');
                } else if (href.includes('settings')) {
                    loadPage('logged-in/settings.html');
                } else if (href.includes('authentication') || href.includes('logout')) {
                    loadPage('authentication.html');
                } else {
                    // Fallback to external or just load it
                    // If it's a local page we support:
                    // loadPage(href); 
                    // But we need to clean path
                }
            }
        }
    });
    
    // Expose a global redirect helper for scripts
    window.localRedirect = (path) => {
        if (path.includes('index.html') || path.includes('authentication.html')) {
             loadPage('authentication.html');
        } else if (path.includes('dashboard.html')) {
             loadPage('logged-in/dashboard.html');
        }
    };
    
    // Initial Load
    init();

})();
