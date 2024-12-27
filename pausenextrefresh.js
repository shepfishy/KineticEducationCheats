// ==UserScript==
// @name         Website Control GUI
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Adds Pause/Next/Refresh controls
// @author       shep
// @match        https://www.elearnoncloud.com/STUDENT/Tutorials/Question.*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // State variables
    let requestLog = [];
    let requestQueue = [];
    let isPaused = false;

    // Add after state variables
    const guiContainer = document.createElement('div');

    // Create network traffic display
    const trafficDisplay = document.createElement('div');
    trafficDisplay.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 20px;
        width: 300px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.8);
        padding: 10px;
        border-radius: 5px;
        color: white;
        font-family: monospace;
        font-size: 12px;
    `;
    document.body.appendChild(trafficDisplay);

    // Intercept and log network requests
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;

    // Update Fetch interceptor
    window.fetch = function(...args) {
        const request = {
            type: 'fetch',
            method: typeof args[0] === 'string' ? 'GET' : args[0].method || 'GET',
            url: typeof args[0] === 'string' ? args[0] : args[0].url,
            headers: typeof args[0] === 'string' ? {} : args[0].headers || {},
            timestamp: new Date(),
            status: 'pending'
        };
        requestLog.push(request);
        updateDisplay();

        if (isPaused) {
            requestQueue.push({args, type: 'fetch'});
            return new Promise(() => {}); // Never resolves while paused
        }

        return originalFetch.apply(this, args)
            .then(response => {
                request.status = response.ok ? 'success' : 'error';
                updateDisplay();
                return response;
            })
            .catch(error => {
                request.status = 'error';
                updateDisplay();
                throw error;
            });
    };

    // Enhance request object structure
    window.XMLHttpRequest = function() {
        const xhr = new originalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;
        const originalSetRequestHeader = xhr.setRequestHeader;
        let headers = {};

        xhr.setRequestHeader = function(name, value) {
            headers[name] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        xhr.open = function(...args) {
            const request = {
                type: 'xhr',
                method: args[0].toUpperCase(),
                url: args[1],
                timestamp: new Date(),
                status: 'pending',
                headers: headers
            };
            requestLog.push(request);
            updateDisplay();

            if (isPaused) {
                requestQueue.push({xhr: this, args, type: 'xhr'});
                return;
            }

            xhr.addEventListener('load', () => {
                request.status = xhr.status >= 200 && xhr.status < 300 ? 'success' : 'error';
                updateDisplay();
            });

            return originalOpen.apply(this, args);
        };

        xhr.send = function(...args) {
            if (isPaused) return;
            return originalSend.apply(this, args);
        };

        return xhr;
    };

    // WebSocket interceptor
    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(...args) {
        const request = {
            type: 'websocket',
            method: 'GET',  // WebSocket initial handshake uses GET
            url: args[0],
            timestamp: new Date(),
            status: 'pending'
        };
        const ws = new originalWebSocket(...args);

        requestLog.push(request);

        ws.addEventListener('open', () => {
            request.status = 'success';
            updateDisplay();
        });

        ws.addEventListener('error', () => {
            request.status = 'error';
            updateDisplay();
        });

        updateDisplay();
        return ws;
    };

    // Beacon API interceptor
    const originalBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function(url, data) {
        const request = {
            type: 'beacon',
            method: 'POST',  // Beacon API uses POST
            url: url,
            timestamp: new Date(),
            status: 'pending'
        };
        requestLog.push(request);
        updateDisplay();

        if (isPaused) {
            requestQueue.push({url, data, type: 'beacon'});
            return false;
        }

        const result = originalBeacon.apply(this, arguments);
        request.status = result ? 'success' : 'error';
        updateDisplay();
        return result;
    };

    // EventSource interceptor
    const originalEventSource = window.EventSource;
    window.EventSource = function(...args) {
        const request = {
            type: 'eventsource',
            method: 'GET',  // EventSource uses GET
            url: args[0],
            timestamp: new Date(),
            status: 'pending'
        };
        const es = new originalEventSource(...args);

        requestLog.push(request);

        es.addEventListener('open', () => {
            request.status = 'success';
            updateDisplay();
        });

        es.addEventListener('error', () => {
            request.status = 'error';
            updateDisplay();
        });

        updateDisplay();
        return es;
    };

    // Resource load interceptor
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.tagName === 'IMG' || node.tagName === 'SCRIPT' || node.tagName === 'LINK') {
                    const request = {
                        type: node.tagName.toLowerCase(),
                        method: 'GET',  // Resource loads use GET
                        url: node.src || node.href,
                        timestamp: new Date(),
                        status: 'pending'
                    };
                    requestLog.push(request);

                    node.addEventListener('load', () => {
                        request.status = 'success';
                        updateDisplay();
                    });

                    node.addEventListener('error', () => {
                        request.status = 'error';
                        updateDisplay();
                    });

                    updateDisplay();
                }
            });
        });
    });

    observer.observe(document, {
        childList: true,
        subtree: true
    });

    // Form submission interceptor
    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
        const request = {
            type: 'form',
            method: this.method.toUpperCase() || 'GET',  // Use form's method or default to GET
            url: this.action,
            timestamp: new Date(),
            status: 'pending'
        };
        requestLog.push(request);
        updateDisplay();

        if (isPaused) {
            requestQueue.push({form: this, type: 'form'});
            return;
        }

        return originalSubmit.apply(this);
    };

    // Update display function to show full history
    function updateDisplay() {
        const allRequests = requestLog.reverse();
        trafficDisplay.innerHTML = `
            <div style="margin-bottom: 5px;border-bottom:1px solid #444;padding-bottom:5px">
                Network Traffic Log (${allRequests.length} requests)
            </div>
            ${allRequests.map((req, index) =>
                `<div style="margin:2px 0;border-bottom:1px solid #333;padding:2px 0">
                    <div style="color:#888;font-size:10px">
                        ${req.timestamp.toLocaleTimeString()}
                    </div>
                    <div>
                        <span style="color: ${req.method === 'GET' ? '#81c784' : '#e57373'}">${req.method}</span>
                        ${req.type}: ${req.url.substring(0, 40)}${req.url.length > 40 ? '...' : ''}
                        <span style="float:right;color:${
                            req.status === 'success' ? '#81c784' :
                            req.status === 'error' ? '#e57373' :
                            '#ffb74d'
                        }">${req.status}</span>
                    </div>
                    <div style="font-size:10px;color:#888;margin-top:2px">
                        ${Object.entries(req.headers || {}).map(([key, value]) =>
                            `${key}: ${value}`
                        ).join('<br>')}
                    </div>
                </div>`
            ).join('')}
        `;
        trafficDisplay.scrollTop = trafficDisplay.scrollHeight;
    }

    // Update GUI container style
    guiContainer.style.cssText = `
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        z-index: 2147483647 !important;
        background: rgba(0, 0, 0, 0.8) !important;
        padding: 10px !important;
        border-radius: 5px !important;
        display: flex !important;
        gap: 5px !important;
        pointer-events: auto !important;
    `;

    // Update traffic display style
    trafficDisplay.style.cssText = `
        position: fixed !important;
        bottom: 80px !important;
        right: 20px !important;
        width: 300px !important;
        max-height: 400px !important;
        overflow-y: auto !important;
        z-index: 2147483647 !important;
        background: rgba(0, 0, 0, 0.8) !important;
        padding: 10px !important;
        border-radius: 5px !important;
        color: white !important;
        font-family: monospace !important;
        font-size: 12px !important;
        pointer-events: auto !important;
    `;

    // Create buttons
    const buttons = [
        { text: 'Pause', id: 'pauseBtn' },
        { text: 'Next', id: 'nextBtn' },
        { text: 'Refresh', id: 'refreshBtn' }
    ].map(btn => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.id = btn.id;
        button.style.cssText = `
            padding: 5px 10px;
            border: none;
            border-radius: 3px;
            background: #4CAF50;
            color: white;
            cursor: pointer;
            font-size: 14px;
        `;
        button.addEventListener('mouseover', () => button.style.opacity = '0.8');
        button.addEventListener('mouseout', () => button.style.opacity = '1');
        return button;
    });

    // Add buttons to container
    buttons.forEach(btn => guiContainer.appendChild(btn));

    // Add container to page
    document.body.appendChild(guiContainer);

    // Button click handlers
    document.getElementById('pauseBtn').addEventListener('click', function() {
        isPaused = !isPaused;
        this.style.background = isPaused ? '#ff4444' : '#4CAF50';
        this.textContent = isPaused ? 'Resume' : 'Pause';

        if (!isPaused && requestQueue.length > 0) {
            requestQueue = [];
        }
    });

    document.getElementById('nextBtn').addEventListener('click', function() {
        const nextButton = document.getElementById('imgOK');
        if (nextButton) {
            nextButton.click();
        }
    });

    document.getElementById('refreshBtn').addEventListener('click', function() {
        window.location.reload();
    });
})();