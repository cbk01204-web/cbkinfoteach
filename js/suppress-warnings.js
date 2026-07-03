(function() {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'DOMNodeInsertedIntoDocument' || 
            type === 'DOMNodeInserted' || 
            type === 'DOMNodeRemoved' || 
            type === 'DOMSubtreeModified' ||
            type === 'DOMNodeRemovedFromDocument') {
            // Block deprecated mutation events to prevent browser warnings
            return;
        }
        return originalAddEventListener.call(this, type, listener, options);
    };
})();
